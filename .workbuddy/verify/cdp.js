'use strict';
/**
 * cdp.js — 极简 Chrome DevTools Protocol 客户端 + 常用操作助手（零依赖，Node ≥ 22 自带 WebSocket/fetch）
 *
 * 连接浏览器级 WebSocket（/json/version 里的 webSocketDebuggerUrl），
 * 用 Target.createTarget + Target.attachToTarget(flatten:true) 拿到 sessionId，
 * 之后所有页面级命令都带 sessionId 发送（平铺会话）。
 */
const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  /** @param {string} wsUrl */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    this.opened = false;
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('CDP WebSocket 连接超时')); }
      }, timeoutMs || 15000);
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        clearTimeout(timer);
        return reject(e);
      }
      this.ws = ws;
      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.opened = true;
        resolve(this);
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
        } catch (_) { return; }
        this._dispatch(msg);
      });
      ws.addEventListener('error', (ev) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('CDP WebSocket 错误: ' + ((ev && ev.message) || 'unknown')));
      });
      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new Error('CDP 连接已关闭'));
        this.pending.clear();
      });
    });
  }

  _dispatch(msg) {
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error('CDP ' + msg.error.message + (msg.error.data ? ' / ' + msg.error.data : '')));
      else p.resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      for (const fn of this.listeners) {
        try { fn({ method: msg.method, params: msg.params || {}, sessionId: msg.sessionId }); } catch (_) { /* ignore */ }
      }
    }
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    if (this.closed || !this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new Error('CDP 未连接，无法发送 ' + method));
    }
    const id = this.nextId++;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP 超时 ' + method + ' (' + (timeoutMs || 30000) + 'ms)'));
      }, timeoutMs || 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  waitEvent(method, sessionId = undefined, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const off = this.on((ev) => {
        if (ev.method !== method) return;
        if (sessionId && ev.sessionId !== sessionId) return;
        clearTimeout(timer);
        off();
        resolve(ev.params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error('等待事件超时 ' + method));
      }, timeoutMs || 15000);
    });
  }

  close() {
    this.closed = true;
    try { if (this.ws) this.ws.close(); } catch (_) { /* ignore */ }
  }
}

/* ============================ 页面操作助手 ============================ */

/**
 * Runtime.evaluate，返回 JS 值（returnByValue）。
 * @throws 页面异常时抛错，便于定位
 */
async function evaluate(cdp, sessionId, expression, opts = {}) {
  const params = {
    expression,
    returnByValue: true,
    awaitPromise: !!opts.awaitPromise,
    userGesture: true,
    includeCommandLineAPI: false,
  };
  const res = await cdp.send('Runtime.evaluate', params, sessionId, opts.timeoutMs || 30000);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown';
    throw new Error('页面 JS 异常: ' + String(desc).split('\n')[0] + ' @ ' + (d.url || '') + ':' + (d.lineNumber == null ? '?' : d.lineNumber));
  }
  const r = res.result || {};
  if (r.type === 'undefined') return undefined;
  return r.value;
}

/**
 * 轮询断言表达式，直到为真；默认每 120ms 一次。
 * @param {string} expression 返回 truthy/falsy 的 JS 表达式
 */
async function waitForExpr(cdp, sessionId, expression, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const intervalMs = opts.intervalMs || 120;
  const desc = opts.description || expression.slice(0, 80);
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(cdp, sessionId, '(()=>{ try { return !!(' + expression + '); } catch(e) { return false; } })()');
      if (lastValue) return true;
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw new Error('等待超时(' + timeoutMs + 'ms): ' + desc + (lastErr ? ' / 最后异常: ' + lastErr.message : ''));
}

async function clickSelector(cdp, sessionId, selector) {
  return evaluate(cdp, sessionId, '(()=>{ var el=document.querySelector(' + JSON.stringify(selector) + '); if(!el) throw new Error("未找到元素 "+' + JSON.stringify(selector) + '); el.click(); return true; })()');
}

/** 在 selector 范围内按包含文本点击（常用于弹窗底部按钮） */
async function clickByText(cdp, sessionId, selector, text) {
  return evaluate(
    cdp, sessionId,
    '(()=>{ var list=Array.prototype.slice.call(document.querySelectorAll(' + JSON.stringify(selector) + '));' +
    ' var el=list.filter(function(b){ return (b.textContent||"").indexOf(' + JSON.stringify(text) + ')>=0; })[0];' +
    ' if(!el) throw new Error("未找到文本按钮: "+' + JSON.stringify(text) + '); el.click(); return el.textContent.trim(); })()'
  );
}

/** 设置 <input type=file> 的文件（真实文件路径，绝对路径），会触发 change 事件 */
async function setFiles(cdp, sessionId, selector, files) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0, pierce: false }, sessionId);
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector }, sessionId);
  if (!nodeId) throw new Error('未找到文件输入框 ' + selector);
  await cdp.send('DOM.setFileInputFiles', { nodeId, files }, sessionId);
  return nodeId;
}

/** 覆盖视口（截图分辨率 = width × height × dpr） */
async function setViewport(cdp, sessionId, viewport = {}) {
  const params = {
    width: viewport.width || 1920,
    height: viewport.height || 1080,
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    mobile: !!viewport.mobile,
  };
  if (viewport.mobile) {
    params.screenOrientation = { type: 'portraitPrimary', angle: 0 };
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', params, sessionId);
}

/** 读 PNG 宽高（IHDR） */
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = buf.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Page.captureScreenshot → 写 PNG 文件；返回 {file,bytes,width,height} */
async function screenshot(cdp, sessionId, filePath, opts = {}) {
  try { await cdp.send('Page.bringToFront', {}, sessionId, 5000); } catch (_) { /* 非必需 */ }
  const res = await cdp.send('Page.captureScreenshot', {
    format: opts.format || 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId, 60000);
  const buf = Buffer.from(res.data, 'base64');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  const size = pngSize(buf) || {};
  return { file: filePath, bytes: buf.length, width: size.width, height: size.height };
}

module.exports = {
  CDP,
  sleep,
  evaluate,
  waitForExpr,
  clickSelector,
  clickByText,
  setFiles,
  setViewport,
  screenshot,
  pngSize,
};
