'use strict';
/**
 * smoke.js — 环境自检（不产出基线，只确认 Edge/CDP/file:// 页面能跑）
 *
 * 用法（普通终端，非 DSH 沙箱）：
 *   node smoke.js
 *   node smoke.js --html "C:\...\在校高效系统v0.2.1.html"
 *
 * 通过标准：打印 Edge 版本、页面标题、localStorage 可用、截图 _smoke.png 为 1920x1080、
 * 且 "console/errors: none"（或仅有已知非致命信息）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch } = require('./edge');
const { CDP, sleep, evaluate, waitForExpr, setViewport, screenshot } = require('./cdp');

const WS_ROOT = path.resolve(process.env.WS_ROOT || path.join(__dirname, '..', '..'));
const HTML = process.argv.includes('--html')
  ? path.resolve(process.argv[process.argv.indexOf('--html') + 1])
  : path.join(WS_ROOT, '在校高效系统v0.2.1.html');

let edge = null;
let cdp = null;

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(HTML)) throw new Error('找不到主 HTML: ' + HTML);
  console.log('[smoke] 被测页面: ' + HTML);

  edge = await launch({ edgePath: process.env.EDGE_BIN || undefined });
  console.log('[smoke] Edge 就绪: ' + edge.browserVersion + '，端口 ' + edge.port + '（' + (Date.now() - t0) + 'ms）');

  cdp = new CDP(edge.wsUrl);
  await cdp.connect();
  const logs = [];
  cdp.on((ev) => {
    if (ev.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(ev.params.exceptionDetails).slice(0, 300));
    if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(ev.params.type)) logs.push('CONSOLE ' + ev.params.type + ' ' + JSON.stringify(ev.params.args).slice(0, 300));
    if (ev.method === 'Log.entryAdded' && ['error', 'warning'].includes(ev.params.entry.level)) logs.push('LOG ' + ev.params.entry.level + ' ' + ev.params.entry.text);
  });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await setViewport(cdp, sessionId, { width: 1920, height: 1080, deviceScaleFactor: 1 });

  await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href }, sessionId);
  await waitForExpr(cdp, sessionId,
    "document.readyState==='complete' && !!document.getElementById('clockTime') && document.getElementById('clockTime').textContent.indexOf(':')>0",
    { timeoutMs: 30000, description: '页面加载完成' });
  await waitForExpr(cdp, sessionId, 'document.fonts.status==="loaded"', { timeoutMs: 8000, description: '字体就绪' });
  await sleep(250);

  const state = await evaluate(cdp, sessionId, `(()=>{
    const de = document.documentElement, b = document.body;
    let ls = null;
    try { localStorage.setItem('__smoke__', '1'); localStorage.removeItem('__smoke__'); ls = { ok: true }; } catch (e) { ls = { ok: false, error: String(e) }; }
    return {
      title: document.title,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      emptyVisible: !document.getElementById('empty').hidden,
      panelsHidden: document.getElementById('panels').hidden,
      clock: document.getElementById('clockTime').textContent,
      hasXLSX: typeof window.XLSX !== 'undefined',
      localStorage: ls,
      scroll: [de.scrollWidth, de.clientWidth, de.scrollHeight, de.clientHeight],
      bodyOverflow: getComputedStyle(b).overflow
    };
  })()`);
  console.log('[smoke] 页面状态: ' + JSON.stringify(state, null, 2));

  const shot = await screenshot(cdp, sessionId, path.join(__dirname, '_smoke.png'));
  console.log('[smoke] 截图: ' + shot.file + '  ' + shot.width + 'x' + shot.height + '  ' + Math.round(shot.bytes / 1024) + 'KB');
  if (shot.width !== 1920 || shot.height !== 1080) console.error('[smoke] ⚠ 截图尺寸不是 1920x1080，检查系统缩放/DPI 设置');
  console.log('[smoke] 页面控制台/异常: ' + (logs.length ? '\n  ' + logs.join('\n  ') : 'none'));
  console.log('[smoke] ✅ 环境自检通过，可以运行: node run.js --out before');

  cdp.close();
  edge.close();
  console.log('[smoke] 总耗时 ' + (Date.now() - t0) + 'ms');
})().catch((e) => {
  console.error('[smoke] ❌ 自检失败: ' + ((e && e.stack) || e));
  if (/platform_channel|0x5|拒绝访问/.test(String(e && e.message))) {
    console.error('[smoke] 提示：若日志含 FATAL mojo platform_channel Access denied，说明当前在 DSH 沙箱内，请换普通终端运行。');
  }
  try { if (cdp) cdp.close(); } catch (_) { /* ignore */ }
  try { if (edge) edge.close(); } catch (_) { /* ignore */ }
  process.exitCode = 1;
});
