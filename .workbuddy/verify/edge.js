'use strict';
/**
 * edge.js — 零依赖的 Microsoft Edge (Chromium) headless 启动器
 *
 * 为什么不直接用 pipe 读子进程输出：本机沙箱禁止匿名管道 stdio，
 * 因此 spawn 一律使用 stdio:'ignore'，通过 CDP HTTP(/json/version) 判断是否就绪。
 *
 * 用法：
 *   const { launch } = require('./edge');
 *   const edge = await launch();          // 自动挑空闲端口、清理 profile
 *   ... 用 edge.wsUrl 连 CDP ...
 *   await edge.close();                   // taskkill /T /F，连同子进程一起杀
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDGE_CANDIDATES = [
  process.env.EDGE_BIN,
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (_) { /* 继续找 */ }
  }
  throw new Error('找不到 msedge.exe，可用环境变量 EDGE_BIN 或 --edge 指定路径');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function fetchVersion(port, timeoutMs) {
  const res = await fetch('http://127.0.0.1:' + port + '/json/version', {
    signal: AbortSignal.timeout(timeoutMs || 1500),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 8000,
    });
  } catch (_) { /* ignore */ }
  try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
  // taskkill 后给进程一点时间落盘退出；仍存活则再补一刀
  if (proc.exitCode === null) {
    try {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    } catch (_) { /* ignore */ }
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.profileDir] 独立的 user-data-dir（默认 .workbuddy/verify/profile）
 * @param {string} [opts.edgePath]   显式指定 msedge.exe
 * @param {number} [opts.timeoutMs]  DevTools 就绪超时，默认 30s
 * @param {boolean}[opts.keepProfile] 保留旧 profile（默认每次启动前清空，保证 localStorage 干净）
 * @returns {Promise<{edgePath:string,port:number,wsUrl:string,browserVersion:string,profileDir:string,proc:any,version:()=>Promise<any>,close:()=>void}>}
 */
async function launch(opts = {}) {
  const edgePath = opts.edgePath || findEdge();
  let profileDir = path.resolve(opts.profileDir || path.join(__dirname, 'profile'));
  if (!opts.keepProfile) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
    } catch (e) {
      // 上次崩溃可能残留 Edge 进程占用 profile：换一个带时间戳的目录，保证能启动
      const fallback = profileDir + '-run-' + Date.now();
      console.warn('[edge] 清理 profile 失败（' + e.message + '），改用 ' + fallback);
      profileDir = fallback;
    }
  }
  fs.mkdirSync(profileDir, { recursive: true });

  const port = opts.port || (await getFreePort());
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--mute-audio',
    '--force-device-scale-factor=1',
    '--window-size=1920,1080',
    'about:blank',
  ];

  const proc = spawn(edgePath, args, { stdio: 'ignore', windowsHide: true, detached: false });
  let spawnError = null;
  proc.once('error', (e) => { spawnError = e; });

  const deadline = Date.now() + (opts.timeoutMs || 30000);
  let version = null;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (spawnError) { killTree(proc); throw new Error('Edge 启动失败: ' + spawnError.message); }
    if (proc.exitCode !== null) { throw new Error('Edge 启动后立即退出，exitCode=' + proc.exitCode); }
    try {
      version = await fetchVersion(port);
      break;
    } catch (e) {
      lastErr = e;
      await sleep(150);
    }
  }
  if (!version) {
    killTree(proc);
    throw new Error('等待 Edge DevTools 超时(' + port + '): ' + (lastErr && lastErr.message));
  }
  if (!version.webSocketDebuggerUrl) {
    killTree(proc);
    throw new Error('/json/version 未返回 webSocketDebuggerUrl');
  }

  let closed = false;
  return {
    edgePath,
    port,
    wsUrl: version.webSocketDebuggerUrl,
    browserVersion: version.Browser || '',
    profileDir,
    proc,
    version: () => fetchVersion(port),
    close() {
      if (closed) return;
      closed = true;
      killTree(proc);
    },
  };
}

module.exports = { launch, findEdge, getFreePort, killTree, sleep };
