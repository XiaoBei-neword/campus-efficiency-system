'use strict';
/**
 * run.js — Edge headless 截图 + 功能断言基线（before / after 共用同一脚本）
 *
 * 前置：必须在**非 DSH 沙箱**的普通终端里执行（沙箱禁止命名管道，Chromium 的
 * Mojo 通道无法创建，Edge 会以 FATAL platform_channel.cc:187 退出）。
 *
 * 用法：
 *   node run.js --out before
 *   node run.js --out after
 *   node run.js --out before --edge "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
 *   node run.js --out before --html "C:\...\在校高效系统v0.2.1.html" --xlsx "C:\...\示例学生名单_计算机2301.xlsx"
 *
 * 环境变量：EDGE_BIN（msedge.exe 路径）、WS_ROOT（工作目录，默认本脚本上两级）
 *
 * 产物（默认 .workbuddy/verify/<out>/）：
 *   01-empty.png ~ 10-mobile.png、baseline.json、console-<out>.json
 *
 * 设计约束：
 *   - 启动 Edge 一律 stdio:'ignore'，结束后 taskkill /T /F 杀整棵进程树；
 *   - 端口由系统分配空闲端口；
 *   - 每个场景前清 localStorage + reload，用 DOM.setFileInputFiles 真实导入 xlsx；
 *   - 所有“等待渲染”均为轮询断言，不用死 sleep。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { launch, sleep } = require('./edge');
const {
  CDP, evaluate, waitForExpr, clickSelector, clickByText, setFiles, setViewport, screenshot,
} = require('./cdp');

/* ============================== 常量与配置 ============================== */

const VERIFY_DIR = __dirname;
const WS_ROOT = path.resolve(process.env.WS_ROOT || path.join(__dirname, '..', '..'));
const DEFAULT_HTML = path.join(WS_ROOT, '在校高效系统v0.2.1.html');
const DEFAULT_XLSX = path.join(WS_ROOT, '示例学生名单_计算机2301.xlsx');

const DESKTOP = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

const EXPECT_STUDENTS = 42;         // 示例学生名单_计算机2301.xlsx（含表头共 45 行，识别 42 人）
const EXPECT_MAIN_COLUMNS = 3;      // 语数英 = 语文 / 数学 / 英语
const EXPECT_SOC_COLUMNS = 2;       // 道法历史 = 道法 / 历史
const SEARCH_QUERY = '202311010';   // 命中 2023110101~2023110109 共 9 人
const EXPECT_SEARCH_HITS = 9;
const LS_KEY = 'hw_attendance_v1';

/** 页面就绪判定：应用初始化后时钟已被 tick() 写入（HH:MM:SS） */
const READY_EXPR = "document.readyState==='complete' && !!document.getElementById('clockTime') && document.getElementById('clockTime').textContent.indexOf(':')>0";

/* ============================== 参数解析 ============================== */

function printHelp() {
  console.log([
    '用法: node run.js --out before|after [选项]',
    '  --out <label>   产物目录标签，默认 before；截图与 baseline.json 写入 .workbuddy/verify/<label>/',
    '  --html <file>   被测 HTML，默认 <WS_ROOT>/在校高效系统v0.2.1.html',
    '  --xlsx <file>   示例名单，默认 <WS_ROOT>/示例学生名单_计算机2301.xlsx',
    '  --edge <file>   msedge.exe 路径（默认自动探测，或读环境变量 EDGE_BIN）',
    '  --port <n>      DevTools 端口（默认系统自动分配空闲端口）',
    '  --dry-run       只校验参数与文件，不启动 Edge',
    '  --help          显示帮助',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = {
    label: 'before',
    html: DEFAULT_HTML,
    xlsx: DEFAULT_XLSX,
    edge: process.env.EDGE_BIN || '',
    port: 0,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error('参数 ' + a + ' 缺少取值');
      return v;
    };
    if (a === '--out' || a === '--label') opts.label = next();
    else if (a === '--html') opts.html = path.resolve(next());
    else if (a === '--xlsx') opts.xlsx = path.resolve(next());
    else if (a === '--edge' || a === '--edge-bin') opts.edge = path.resolve(next());
    else if (a === '--port') opts.port = parseInt(next(), 10) || 0;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error('未知参数: ' + a);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(opts.label) || opts.label === '.' || opts.label === '..') {
    throw new Error('--out 只允许字母数字/点/下划线/中划线，禁止路径穿越: ' + opts.label);
  }
  return opts;
}

/* ============================== 工具函数 ============================== */

const nowLog = () => new Date().toTimeString().slice(0, 8);
let currentStep = 'setup';
function log(msg) { console.log('[' + nowLog() + '][' + currentStep + '] ' + msg); }
function short(v, n) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > (n || 220) ? s.slice(0, n || 220) + '…' : s;
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function fmtDuration(ms) {
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}

/* ============================== 页面内辅助函数（注入到 Runtime.evaluate 的表达式里） ============================== */

const H_LS = `
function __ls() {
  try {
    var raw = localStorage.getItem(${JSON.stringify(LS_KEY)});
    if (!raw) return { hasKey: false };
    var d = JSON.parse(raw);
    var days = {};
    Object.keys(d.days || {}).forEach(function (k) {
      var day = d.days[k] || {}, o = {};
      Object.keys(day).forEach(function (sk) {
        var r = day[sk] || {};
        o[sk] = { order: (r.order || []).length, times: Object.keys(r.times || {}).length };
      });
      days[k] = o;
    });
    return { hasKey: true, students: (d.students || []).length, sourceName: d.sourceName || '', importedAt: d.importedAt || 0, days: days };
  } catch (e) { return { hasKey: false, error: String(e) }; }
}
`;

const H_SCROLL = `
function __scroll() {
  var de = document.documentElement, b = document.body;
  var cs = getComputedStyle(b);
  return {
    innerWidth: innerWidth, innerHeight: innerHeight, dpr: devicePixelRatio,
    docScrollWidth: de.scrollWidth, docScrollHeight: de.scrollHeight,
    docClientWidth: de.clientWidth, docClientHeight: de.clientHeight,
    bodyScrollWidth: b.scrollWidth, bodyScrollHeight: b.scrollHeight,
    bodyOverflowX: cs.overflowX, bodyOverflowY: cs.overflowY,
    hasHScroll: de.scrollWidth > de.clientWidth + 1,
    hasVScroll: de.scrollHeight > de.clientHeight + 1,
    bodyHasHScroll: b.scrollWidth > b.clientWidth + 1,
    bodyHasVScroll: b.scrollHeight > b.clientHeight + 1
  };
}
`;

const H_TILES = `
function __tiles() {
  function t(id) { var el = document.getElementById(id); return el ? el.textContent.trim() : null; }
  var sub = document.getElementById('stTotalSub');
  return { total: t('stTotal'), done: t('stDone'), left: t('stLeft'), rate: t('stRate'), sub: t('stTotalSub'), subTitle: sub ? (sub.title || '') : '' };
}
`;

const H_LAYOUT = `
function __rect(el) {
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
}
function __layout() {
  var q = function (s) { return document.querySelector(s); };
  var subjs = Array.prototype.map.call(document.querySelectorAll('.subj-panels.active .subj'), function (s) {
    var grid = s.querySelector('.subj-grid');
    return {
      name: (s.querySelector('.subj-name') || {}).textContent || '',
      box: __rect(s),
      grid: __rect(grid),
      cardCount: s.querySelectorAll('.scard').length,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : ''
    };
  });
  return {
    viewport: [innerWidth, innerHeight],
    topbar: __rect(q('.topbar')),
    stats: __rect(q('.stats')),
    board: __rect(q('.board')),
    boardHead: __rect(q('.board-head')),
    panels: __rect(q('#panels')),
    empty: __rect(q('#empty')),
    statsView: __rect(q('#statsView')),
    activeWrap: __rect(q('.subj-panels.active')),
    subjects: subjs,
    sampleCard: __rect(q('.subj-panels.active .scard')),
    sampleDoneCard: __rect(q('.subj-panels.active .scard.done'))
  };
}
`;

const H_STYLE = `
function __style() {
  var specs = {
    body: 'body', topbar: '.topbar', brand: '.brand h1', stats: '.stats', tile: '.tile',
    board: '.board', boardHead: '.board-head', tabActive: '.tab.active', btn: '.btn',
    btnPrimary: '.btn-primary', search: '.search input', subj: '.subj', subjHead: '.subj-head',
    scard: '.subj-panels.active .scard', scardDone: '.subj-panels.active .scard.done',
    empty: '#empty', modal: '.modal', modalMask: '.modal-mask', tblTh: '.tbl th', foot: '.foot'
  };
  var out = {};
  Object.keys(specs).forEach(function (k) {
    var el = document.querySelector(specs[k]);
    if (!el) { out[k] = null; return; }
    var cs = getComputedStyle(el);
    out[k] = {
      background: cs.backgroundColor,
      backgroundImage: String(cs.backgroundImage || '').slice(0, 180),
      color: cs.color,
      borderColor: cs.borderTopColor,
      borderRadius: cs.borderTopLeftRadius,
      boxShadow: String(cs.boxShadow || '').slice(0, 160),
      fontFamily: String(cs.fontFamily || '').slice(0, 80),
      padding: cs.padding,
      gap: cs.gap
    };
  });
  return out;
}
`;

const H_COMMON = H_LS + H_SCROLL + H_TILES + H_LAYOUT + H_STYLE;

/** 读取 active 科目组的面板状态 */
function exprMain() {
  return `(()=>{${H_COMMON}
    var wrap = document.querySelector('.subj-panels.active');
    var subjs = wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.subj')) : [];
    return {
      columns: subjs.length,
      names: subjs.map(function (s) { var n = s.querySelector('.subj-name'); return n ? n.textContent.trim() : ''; }),
      cardsPerSubject: subjs.map(function (s) { return s.querySelectorAll('.scard').length; }),
      countTexts: subjs.map(function (s) { var c = s.querySelector('.subj-cnt'); return c ? c.textContent.trim() : ''; }),
      totalCards: wrap ? wrap.querySelectorAll('.scard').length : 0,
      panelGroups: document.querySelectorAll('.subj-panels').length,
      activeGroup: wrap ? wrap.getAttribute('data-group') : null,
      panelsHidden: document.getElementById('panels').hidden,
      emptyVisible: !document.getElementById('empty').hidden,
      statsHidden: document.getElementById('statsView').hidden,
      tiles: __tiles(),
      ls: __ls(),
      scroll: __scroll(),
      layout: __layout()
    };
  })()`;
}

/** 读取完成态（卡片 done 数、名次徽章、localStorage 记录） */
function exprDone() {
  return `(()=>{${H_COMMON}
    var wrap = document.querySelector('.subj-panels.active');
    var subjs = wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.subj')) : [];
    var badges = Array.prototype.map.call(document.querySelectorAll('.subj-panels.active .sc-b'), function (b) {
      return { text: b.textContent.trim(), className: b.className };
    });
    return {
      columns: subjs.length,
      donePerSubject: subjs.map(function (s) { return s.querySelectorAll('.scard.done').length; }),
      doneTotal: wrap ? wrap.querySelectorAll('.scard.done').length : 0,
      badges: badges,
      tiles: __tiles(),
      ls: __ls(),
      scroll: __scroll()
    };
  })()`;
}

/** 读取完成率统计视图 */
function exprStats() {
  return `(()=>{${H_COMMON}
    var sv = document.getElementById('statsView');
    var tables = sv.querySelectorAll('table.tbl');
    var tbl = tables[0];
    var heads = tbl ? Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); }) : [];
    var rows = tbl ? Array.prototype.slice.call(tbl.querySelectorAll('tbody tr')) : [];
    var dayLists = sv.querySelectorAll('.day-list');
    var overview = dayLists[0] ? Array.prototype.map.call(dayLists[0].querySelectorAll('.day-card'), function (c) { return c.textContent.replace(/\\s+/g, ' ').trim(); }) : [];
    var firstRow = rows[0] ? Array.prototype.map.call(rows[0].children, function (td) { return td.textContent.replace(/\\s+/g, ' ').trim(); }) : [];
    return {
      statsHidden: sv.hidden,
      panelsHidden: document.getElementById('panels').hidden,
      statsActive: (document.querySelector('.tab[data-view="stats"]') || {}).classList ? document.querySelector('.tab[data-view="stats"]').classList.contains('active') : null,
      checkinActive: document.querySelector('.tab[data-view="checkin"]').classList.contains('active'),
      tableCount: tables.length,
      headerCount: heads.length,
      headers: heads,
      rowCount: rows.length,
      overviewCount: overview.length,
      overview: overview,
      dayCardCount: sv.querySelectorAll('.day-card').length,
      firstRow: firstRow,
      viewPad: !!sv.querySelector('.view-pad'),
      statsScroll: { scrollHeight: sv.scrollHeight, clientHeight: sv.clientHeight, scrollWidth: sv.scrollWidth, clientWidth: sv.clientWidth },
      scroll: __scroll()
    };
  })()`;
}

/** 读取弹窗状态 */
function exprModal() {
  return `(()=>{${H_COMMON}
    var mask = document.getElementById('modalMask');
    var modal = mask.querySelector('.modal');
    var r = modal.getBoundingClientRect();
    return {
      open: mask.hidden === false,
      hidden: mask.hidden,
      title: document.getElementById('modalTitle').textContent.trim(),
      desc: document.getElementById('modalDesc').hidden ? '' : document.getElementById('modalDesc').textContent.trim(),
      bodyText: document.getElementById('modalBody').textContent.replace(/\\s+/g, ' ').trim().slice(0, 400),
      footButtons: Array.prototype.map.call(document.querySelectorAll('#modalFoot .btn'), function (b) { return b.textContent.trim(); }),
      bodyOverflow: getComputedStyle(document.body).overflow,
      inlineBodyOverflow: document.body.style.overflow,
      wide: modal.classList.contains('wide'),
      modalRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
      viewport: [innerWidth, innerHeight],
      optCount: document.querySelectorAll('#modalBody .opt').length,
      checkedRadio: (document.querySelector('input[name=rs]:checked') || {}).value || null,
      histDates: document.querySelectorAll('#histDates .hd').length,
      histTblRows: document.querySelectorAll('#histBody .hist-tbl tbody tr').length,
      histHk: document.querySelectorAll('#histBody .hk').length,
      histSum: (document.getElementById('histSum') || {}).textContent ? document.getElementById('histSum').textContent.replace(/\\s+/g, ' ').trim() : '',
      addFields: [!!document.getElementById('inSid'), !!document.getElementById('inName')],
      errSid: (document.getElementById('errSid') || {}).textContent || '',
      optOn: Array.prototype.map.call(document.querySelectorAll('#modalBody .opt'), function (o) { return o.classList.contains('on'); })
    };
  })()`;
}

/** 读取搜索过滤状态 */
function exprSearch() {
  return `(()=>{${H_COMMON}
    var wrap = document.querySelector('.subj-panels.active');
    var subjs = wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.subj')) : [];
    return {
      inputValue: document.getElementById('search').value,
      totalCards: wrap ? wrap.querySelectorAll('.scard').length : 0,
      cardsPerSubject: subjs.map(function (s) { return s.querySelectorAll('.scard').length; }),
      countTexts: subjs.map(function (s) { var c = s.querySelector('.subj-cnt'); return c ? c.textContent.trim() : ''; }),
      blankCount: wrap ? wrap.querySelectorAll('.blank').length : 0,
      blankTexts: Array.prototype.map.call(document.querySelectorAll('.subj-panels.active .blank'), function (b) { return b.textContent.trim(); }),
      firstCards: Array.prototype.map.call(document.querySelectorAll('.subj-panels.active .subj .scard'), function (c) { return c.getAttribute('data-sid'); }).slice(0, 6),
      tiles: __tiles(),
      scroll: __scroll()
    };
  })()`;
}

function setSearchExpr(value) {
  return '(()=>{ if (!window.__searchPatched) { window.__searchPatched = 1; } var el = document.getElementById("search");' +
    ' if (!el) throw new Error("未找到 #search"); el.focus();' +
    ' var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;' +
    ' setter.call(el, ' + JSON.stringify(value) + ');' +
    ' el.dispatchEvent(new Event("input", { bubbles: true })); return el.value; })()';
}

/**
 * dry-run 时在 Node 侧编译所有注入页面的表达式（只编译不执行），
 * 提前发现表达式语法错误，避免 Lead 在真跑浏览器时才发现。
 */
function validateInjectedExpressions() {
  const exprs = {
    READY_EXPR,
    exprMain: exprMain(),
    exprDone: exprDone(),
    exprStats: exprStats(),
    exprModal: exprModal(),
    exprSearch: exprSearch(),
    exprImportPreview: exprImportPreview(),
    setSearchExpr: setSearchExpr(SEARCH_QUERY),
    styleSample: '(()=>{' + H_STYLE + ' return __style(); })()',
    lsOnly: '(()=>{' + H_LS + ' return __ls(); })()',
    importPreviewWait: "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.indexOf('确认导入')>=0",
    importConfirmWait: "document.getElementById('modalMask').hidden===true && !document.getElementById('panels').hidden && document.querySelectorAll('.subj-panels.active .subj').length===3 && document.querySelectorAll('.subj-panels.active .scard').length===126",
    click3cards: "(()=>{ ['yw','sx','yy'].forEach(function (sk) { var c = document.querySelector('.subj-panels.active .subj-grid[data-subject=\"' + sk + '\"] .scard'); if (c) c.click(); }); return true; })()",
    localStorageClear: '(()=>{ try { var ks = Object.keys(localStorage); localStorage.clear(); return { ok: true, keys: ks }; } catch (e) { return { ok: false, error: String(e) }; } })()',
    emptyState: '!document.getElementById("empty").hidden && document.getElementById("panels").hidden && document.querySelectorAll("#panels .scard").length===0',
    resetModalWait: "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='重置数据'",
    addModalWait: "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='新增学生'",
    historyModalWait: "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='完成记录'",
    errSidWait: "(document.getElementById('errSid') || {}).textContent==='请输入学号'",
    noMatchWait: "document.querySelectorAll('.subj-panels.active .scard').length===0 && document.querySelectorAll('.subj-panels.active .blank').length===3",
    switchMainWait: "(function(){ var w = document.querySelector('.subj-panels.active'); return !!w && w.getAttribute('data-group')==='main'; })()",
    switchSocWait: "(function(){ var w = document.querySelector('.subj-panels.active'); return !!w && w.getAttribute('data-group')==='soc' && w.querySelectorAll('.subj').length===2; })()",
  };
  const errors = [];
  const names = Object.keys(exprs);
  for (const name of names) {
    try { new Function('return (' + exprs[name] + ');'); }
    catch (e) { errors.push({ name, error: e.message }); }
  }
  return { count: names.length, errors };
}

/* ============================== 控制台/异常采集 ============================== */

function describeRemoteObject(a) {
  if (!a) return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.description) return a.description;
  if (a.unserializableValue) return a.unserializableValue;
  return a.type || '';
}

class ConsoleRecorder {
  constructor(cdp) {
    this.entries = [];
    this.step = 'setup';
    this.totalConsoleCalls = 0;
    this.off = cdp.on((ev) => this.handle(ev));
  }

  handle(ev) {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails || {};
      const exception = d.exception || {};
      const text = (exception.description || d.text || exception.value || '页面未捕获异常').toString();
      this.entries.push({
        kind: 'exception', level: 'error', step: this.step,
        text: text.split('\n')[0],
        url: d.url || '', line: d.lineNumber == null ? null : d.lineNumber + 1,
      });
      return;
    }
    if (ev.method === 'Runtime.consoleAPICalled') {
      this.totalConsoleCalls++;
      const type = ev.params.type;
      if (type !== 'error' && type !== 'warning' && type !== 'assert') return;
      this.entries.push({
        kind: 'console', level: type, step: this.step,
        text: (ev.params.args || []).map(describeRemoteObject).join(' '),
        url: (ev.params.stackTrace && ev.params.stackTrace.callFrames && ev.params.stackTrace.callFrames[0] || {}).url || '',
        line: null,
      });
      return;
    }
    if (ev.method === 'Log.entryAdded') {
      const e = ev.params.entry || {};
      if (e.level !== 'error' && e.level !== 'warning') return;
      this.entries.push({
        kind: 'log', level: e.level, step: this.step,
        text: e.text || '', url: e.url || '', line: null, source: e.source || '',
      });
    }
  }

  summary() {
    const errors = this.entries.filter((e) => e.level === 'error').length;
    const warnings = this.entries.filter((e) => e.level === 'warning').length;
    return { total: this.entries.length, errors, warnings, totalConsoleCalls: this.totalConsoleCalls };
  }
}

/* ============================== 主流程状态 ============================== */

let opts = null;
let label = 'before';
let outDir = null;
let edge = null;
let cdp = null;
let sessionId = null;
let recorder = null;
let targetId = null;
let runError = null;
let sourceHashBefore = '';
let sourceInfo = null;

const assertions = [];
const observations = {};
const screenshots = [];
const steps = [];
const knownIssues = [];
let failed = 0;

function check(name, ok, expected, actual, note) {
  ok = !!ok;
  const item = { name, ok };
  if (expected !== undefined) item.expected = expected;
  if (actual !== undefined) item.actual = actual;
  if (note) item.note = note;
  assertions.push(item);
  if (!ok) { failed++; log('  ✗ ' + name + (expected !== undefined ? ' | expected=' + short(expected, 120) + ' actual=' + short(actual, 120) : '')); }
  else log('  ✓ ' + name);
  return ok;
}

function observe(key, value, note) {
  const item = { name: 'observe.' + key, ok: true, kind: 'observation', actual: value };
  if (note) item.note = note;
  assertions.push(item);
  observations[key] = value;
}

async function step(id, title, fn) {
  const t = Date.now();
  currentStep = id;
  log('▶ ' + id + ' ' + title);
  try {
    await fn();
    steps.push({ id, title, ms: Date.now() - t, ok: true });
  } catch (e) {
    const message = String((e && e.stack) || e);
    steps.push({ id, title, ms: Date.now() - t, ok: false, error: message });
    log('  ✗ 步骤失败: ' + message.split('\n')[0]);
    throw e;
  }
}

/* ============================== 截图与稳定性 ============================== */

async function settle(opts2 = {}) {
  const waitToast = opts2.toast !== false;
  if (waitToast) {
    try {
      await waitForExpr(cdp, sessionId, "document.querySelectorAll('#toasts .toast:not(.out)').length===0", {
        timeoutMs: opts2.toastTimeoutMs || 4200, description: '等待 toast 消失',
      });
    } catch (_) { /* toast 超时不阻塞截图 */ }
  }
  try {
    await evaluate(cdp, sessionId,
      '(async()=>{ try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e) {}' +
      ' await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); return true; })()',
      { awaitPromise: true, timeoutMs: 15000 });
  } catch (_) { /* 忽略字体等待失败 */ }
  await sleep(opts2.ms == null ? 80 : opts2.ms);
}

async function shot(id, title, expectedViewport) {
  await settle();
  const file = id + '.png';
  const abs = path.join(outDir, file);
  const info = await screenshot(cdp, sessionId, abs);
  screenshots.push({ id, title, file: label + '/' + file, width: info.width, height: info.height, bytes: info.bytes });
  log('  📸 ' + label + '/' + file + ' (' + info.width + 'x' + info.height + ', ' + Math.round(info.bytes / 1024) + 'KB)');
  if (expectedViewport) {
    check('screenshot.' + id + '.size', info.width === expectedViewport.width && info.height === expectedViewport.height,
      expectedViewport.width + 'x' + expectedViewport.height, info.width + 'x' + info.height);
  }
  return info;
}

/* ============================== 场景动作 ============================== */

async function waitAppReady(timeoutMs) {
  await waitForExpr(cdp, sessionId, READY_EXPR, { timeoutMs: timeoutMs || 30000, description: '页面应用初始化完成' });
}

async function reloadAndWait() {
  await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
  await waitAppReady(30000);
  await settle({ toast: false });
}

async function importSampleXlsx() {
  await setFiles(cdp, sessionId, '#fileInput', [opts.xlsx]);
  const previewExpr = "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.indexOf('确认导入')>=0";
  try {
    await waitForExpr(cdp, sessionId, previewExpr, { timeoutMs: 10000, description: '导入预览弹窗出现' });
  } catch (e) {
    log('  首次 DOM.setFileInputFiles 未触发导入，兜底派发 change 事件');
    await setFiles(cdp, sessionId, '#fileInput', [opts.xlsx]);
    await evaluate(cdp, sessionId, 'document.getElementById("fileInput").dispatchEvent(new Event("change",{bubbles:true})); return true;');
    await waitForExpr(cdp, sessionId, previewExpr, { timeoutMs: 10000, description: '导入预览弹窗出现（兜底）' });
  }
}

function exprImportPreview() {
  return `(()=>{
    var kvs = Array.prototype.map.call(document.querySelectorAll('#modalBody .kv'), function (r) {
      var c = r.children;
      return [c[0] ? c[0].textContent.trim() : '', c[1] ? c[1].textContent.trim() : ''];
    });
    var recognized = -1;
    kvs.forEach(function (kv) {
      if (kv[0].indexOf('识别学生') >= 0) { var m = kv[1].match(/^[0-9]+/); if (m) recognized = parseInt(m[0], 10); }
    });
    return {
      open: document.getElementById('modalMask').hidden === false,
      title: document.getElementById('modalTitle').textContent.trim(),
      desc: document.getElementById('modalDesc').hidden ? '' : document.getElementById('modalDesc').textContent.trim(),
      kvs: kvs,
      chips: document.querySelectorAll('#modalBody .chip').length,
      recognized: recognized,
      hasConfirm: Array.prototype.some.call(document.querySelectorAll('#modalFoot .btn'), function (b) { return b.textContent.indexOf('确认导入') >= 0; })
    };
  })()`;
}

/* ============================== 报告输出 ============================== */

function buildReport(startedAt, durationMs) {
  const consoleSummary = recorder ? recorder.summary() : { total: 0, errors: 0, warnings: 0 };
  const hashAfter = opts && fs.existsSync(opts.html) ? sha256File(opts.html) : '';
  const stable = hashAfter === sourceHashBefore;
  return {
    label,
    generatedAt: new Date().toISOString(),
    startedAt,
    durationMs,
    ok: runError === null && failed === 0 && stable,
    runError: runError === null ? null : String((runError && runError.stack) || runError),
    env: {
      node: process.version,
      platform: process.platform,
      verifyDir: VERIFY_DIR,
      wsRoot: WS_ROOT,
      edgeBin: edge ? edge.edgePath : (opts.edge || null),
      edgeVersion: edge ? edge.browserVersion : null,
      devtoolsPort: edge ? edge.port : null,
    },
    viewports: { desktop: DESKTOP, mobile: MOBILE },
    source: {
      path: opts ? opts.html : null,
      fileUrl: opts ? pathToFileURL(opts.html).href : null,
      sha256Before: sourceHashBefore,
      sha256After: hashAfter,
      bytes: sourceInfo ? sourceInfo.bytes : null,
      mtime: sourceInfo ? sourceInfo.mtime : null,
      stableDuringRun: stable,
    },
    sample: {
      path: opts ? opts.xlsx : null,
      sha256: opts && fs.existsSync(opts.xlsx) ? sha256File(opts.xlsx) : null,
      expectedStudents: EXPECT_STUDENTS,
    },
    expectations: {
      students: EXPECT_STUDENTS,
      mainColumns: EXPECT_MAIN_COLUMNS,
      socColumns: EXPECT_SOC_COLUMNS,
      searchQuery: SEARCH_QUERY,
      searchHits: EXPECT_SEARCH_HITS,
      localStorageKey: LS_KEY,
    },
    screenshots,
    assertions,
    observations,
    console: {
      file: label + '/console-' + label + '.json',
      counts: consoleSummary,
      entries: recorder ? recorder.entries.slice(0, 200) : [],
    },
    steps,
    knownIssues,
  };
}

function writeOutputs(report, startedAt) {
  fs.mkdirSync(outDir, { recursive: true });
  const consoleFile = path.join(outDir, 'console-' + label + '.json');
  fs.writeFileSync(consoleFile, JSON.stringify({
    label,
    startedAt,
    browserVersion: report.env.edgeVersion,
    counts: report.console.counts,
    entries: report.console.entries,
  }, null, 2));
  const file = path.join(outDir, 'baseline.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  log('已写出 ' + path.relative(VERIFY_DIR, file) + ' 与 ' + path.relative(VERIFY_DIR, consoleFile));
  return file;
}

/* ============================== 主场景 ============================== */

async function runScenarios() {
  /* ---------- setup ---------- */
  await step('00', '启动 Edge / 建立 CDP 会话 / 清空 localStorage', async () => {
    const profileDir = path.join(VERIFY_DIR, 'profile');
    log('启动 Edge: ' + (opts.edge || process.env.EDGE_BIN || '(自动探测)') + '，profile=' + profileDir);
    edge = await launch({ edgePath: opts.edge || undefined, profileDir, port: opts.port || 0 });
    log('Edge 就绪: ' + edge.browserVersion + '，DevTools 端口 ' + edge.port);
    check('setup.edge.version', !!edge.browserVersion, '非空', edge.browserVersion);

    cdp = new CDP(edge.wsUrl);
    await cdp.connect();
    recorder = new ConsoleRecorder(cdp);

    const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attached.sessionId;
    check('setup.cdp.attached', !!sessionId, 'sessionId', !!sessionId);

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('DOM.enable', {}, sessionId);
    await setViewport(cdp, sessionId, DESKTOP);

    const fileUrl = pathToFileURL(opts.html).href;
    log('导航: ' + fileUrl);
    await cdp.send('Page.navigate', { url: fileUrl }, sessionId);
    await waitAppReady(30000);
    await settle({ toast: false });
    check('setup.page.title', (await evaluate(cdp, sessionId, 'document.title')) === '高校作业考勤系统', '高校作业考勤系统', await evaluate(cdp, sessionId, 'document.title'));
    check('setup.xlsx.inline', (await evaluate(cdp, sessionId, 'typeof window.XLSX !== "undefined"')) === true, true, true);

    const pre = await evaluate(cdp, sessionId,
      '(()=>{ try { var ks = Object.keys(localStorage); localStorage.clear(); return { ok: true, keys: ks }; } catch (e) { return { ok: false, error: String(e) }; } })()');
    observations.localStorage = pre;
    if (!pre || !pre.ok) {
      knownIssues.push({ id: 'localstorage-unavailable', text: 'file:// 下 localStorage 不可用：' + JSON.stringify(pre) + '；持久化相关断言将失败' });
    }
    log('清空 localStorage: 原有键 ' + JSON.stringify((pre && pre.keys) || []) + '，可用=' + !!(pre && pre.ok));
    await reloadAndWait();
    check('setup.reload.emptyState', await evaluate(cdp, sessionId, '!document.getElementById("empty").hidden && document.getElementById("panels").hidden && document.querySelectorAll("#panels .scard").length===0'), true, true);
  });

  /* ---------- 01 空状态 ---------- */
  await step('01', '首屏空状态', async () => {
    const s = await evaluate(cdp, sessionId, `(()=>{${H_COMMON}
      return {
        emptyVisible: !document.getElementById('empty').hidden,
        panelsHidden: document.getElementById('panels').hidden,
        statsHidden: document.getElementById('statsView').hidden,
        cards: document.querySelectorAll('#panels .scard').length,
        emptyTitle: (document.querySelector('#empty h3') || {}).textContent || '',
        tiles: __tiles(),
        btnImportDisabled: document.getElementById('btnImport').disabled,
        btnExportDisabled: document.getElementById('btnExport').disabled,
        statsTabActive: document.querySelector('.tab[data-view="checkin"]').classList.contains('active'),
        importButtonVisible: !!document.getElementById('btnImport'),
        scroll: __scroll()
      };
    })()`);
    check('01.empty.visible', s.emptyVisible === true, true, s.emptyVisible);
    check('01.empty.title', /导入学生名单/.test(s.emptyTitle), '含「导入学生名单」', s.emptyTitle.trim());
    check('01.empty.panelsHidden', s.panelsHidden === true, true, s.panelsHidden);
    check('01.empty.statsHidden', s.statsHidden === true, true, s.statsHidden);
    check('01.empty.cards0', s.cards === 0, 0, s.cards);
    check('01.empty.tilesZero', s.tiles.total === '0' && s.tiles.done === '0' && s.tiles.left === '0' && s.tiles.rate === '0%', '0/0/0/0%', s.tiles.total + '/' + s.tiles.done + '/' + s.tiles.left + '/' + s.tiles.rate);
    check('01.empty.importEnabled', s.btnImportDisabled === false, false, s.btnImportDisabled);
    check('01.empty.exportDisabled', s.btnExportDisabled === true, true, s.btnExportDisabled);
    check('01.empty.noPageScroll', s.scroll.hasHScroll === false && s.scroll.hasVScroll === false, '无滚动', { h: s.scroll.hasHScroll, v: s.scroll.hasVScroll });
    observe('empty', s);
    await shot('01-empty', '首屏空状态', DESKTOP);
  });

  /* ---------- 02 导入 → 主界面 3 栏 ---------- */
  await step('02', 'DOM.setFileInputFiles 导入示例名单 → 主界面 3 栏', async () => {
    await importSampleXlsx();
    const preview = await evaluate(cdp, sessionId, exprImportPreview());
    check('02.import.previewOpen', preview.open === true && /确认导入/.test(preview.title), 'open', preview.title);
    check('02.import.studentsRecognized', preview.recognized === EXPECT_STUDENTS, EXPECT_STUDENTS, preview.recognized);
    check('02.import.confirmButton', preview.hasConfirm === true, true, preview.hasConfirm);
    observe('importPreview', preview);
    await shot('02a-import-preview', '导入预览弹窗（附加证据）', DESKTOP);

    await clickByText(cdp, sessionId, '#modalFoot .btn', '确认导入');
    await waitForExpr(cdp, sessionId,
      "document.getElementById('modalMask').hidden===true && !document.getElementById('panels').hidden && document.querySelectorAll('.subj-panels.active .subj').length===" + EXPECT_MAIN_COLUMNS + " && document.querySelectorAll('.subj-panels.active .scard').length===" + (EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS),
      { timeoutMs: 15000, description: '导入完成并渲染 3 栏卡片' });
    await settle();

    const s = await evaluate(cdp, sessionId, exprMain());
    check('02.main.columns', s.columns === EXPECT_MAIN_COLUMNS, EXPECT_MAIN_COLUMNS, s.columns);
    check('02.main.names', s.names.join('/') === '语文/数学/英语', '语文/数学/英语', s.names.join('/'));
    check('02.main.cardsPerSubject', s.cardsPerSubject.every((n) => n === EXPECT_STUDENTS), EXPECT_STUDENTS, s.cardsPerSubject);
    check('02.main.totalCards', s.totalCards === EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS, EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS, s.totalCards);
    check('02.main.tiles', s.tiles.total === String(EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS) && s.tiles.done === '0' && s.tiles.left === String(EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS) && s.tiles.rate === '0%',
      '126/0/126/0%', s.tiles.total + '/' + s.tiles.done + '/' + s.tiles.left + '/' + s.tiles.rate);
    check('02.main.tilesSub', s.tiles.sub === EXPECT_STUDENTS + ' 人 × 3 科', EXPECT_STUDENTS + ' 人 × 3 科', s.tiles.sub);
    check('02.main.panelsVisible', s.panelsHidden === false && s.emptyVisible === false, 'panels 显示 / empty 隐藏', { panelsHidden: s.panelsHidden, emptyVisible: s.emptyVisible });
    check('02.main.panelGroups', s.panelGroups === 2, 2, s.panelGroups);
    check('02.main.noPageScroll', s.scroll.hasHScroll === false && s.scroll.hasVScroll === false, '无滚动', { h: s.scroll.hasHScroll, v: s.scroll.hasVScroll });
    check('02.storage.key', s.ls.hasKey === true, true, s.ls.hasKey);
    check('02.storage.students', s.ls.students === EXPECT_STUDENTS, EXPECT_STUDENTS, s.ls.students);
    check('02.storage.sourceName', /示例学生名单_计算机2301\.xlsx$/.test(s.ls.sourceName || ''), '示例学生名单_计算机2301.xlsx', s.ls.sourceName);
    check('02.storage.noRecordsYet', Object.keys(s.ls.days || {}).length === 0, 0, Object.keys(s.ls.days || {}).length);
    const lay = s.layout;
    check('02.layout.boardInViewport', !!lay.board && lay.board.bottom <= lay.viewport[1] + 1, 'board.bottom<=viewport', lay.board && lay.board.bottom);
    check('02.layout.panelsFitBoard', !!lay.panels && !!lay.board && lay.panels.bottom <= lay.board.bottom + 1, 'panels 在 board 内', lay.panels && (lay.panels.bottom + '/' + lay.board.bottom));
    check('02.layout.subjectsSized', (lay.subjects || []).length === 3 && lay.subjects.every((x) => x.box && x.box.h > 200 && x.box.w > 100), '3 个科目面板高度>200 宽>100', (lay.subjects || []).map((x) => x.box && x.box.w + 'x' + x.box.h));
    check('02.layout.sampleCard', !!lay.sampleCard && lay.sampleCard.w > 40 && lay.sampleCard.h > 20, '卡片尺寸合理', lay.sampleCard && lay.sampleCard.w + 'x' + lay.sampleCard.h);
    observe('layoutDesktopMain', lay);
    observe('styleDesktopMain', await evaluate(cdp, sessionId, `(()=>{${H_STYLE} return __style(); })()`));
    observe('main', s);
    await shot('02-main', '导入后主界面（3 栏）', DESKTOP);
  });

  /* ---------- 03 点击 3 张卡片完成态 ---------- */
  await step('03', '点击语文/数学/英语各 1 张卡片 → 完成态与名次', async () => {
    await evaluate(cdp, sessionId,
      "(()=>{ ['yw','sx','yy'].forEach(function (sk) { var c = document.querySelector('.subj-panels.active .subj-grid[data-subject=\"' + sk + '\"] .scard'); if (c) c.click(); }); return true; })()");
    await waitForExpr(cdp, sessionId, "document.querySelectorAll('.subj-panels.active .scard.done').length===3", { timeoutMs: 8000, description: '3 张卡片进入完成态' });
    await sleep(450); // 等待完成态过渡/徽章 pop 动画结束

    const s = await evaluate(cdp, sessionId, exprDone());
    check('03.done.total', s.doneTotal === 3, 3, s.doneTotal);
    check('03.done.perSubject', s.donePerSubject.every((n) => n === 1), [1, 1, 1], s.donePerSubject);
    check('03.done.badges', s.badges.length === 3 && s.badges.every((b) => /sc-b/.test(b.className) && /1st/.test(b.text)), '3 个第 1 名徽章', s.badges);
    check('03.done.tilesDone', s.tiles.done === '3' && s.tiles.left === '123' && s.tiles.rate === '2%', '3/123/2%', s.tiles.done + '/' + s.tiles.left + '/' + s.tiles.rate);
    const dayKeys = Object.keys(s.ls.days || {});
    check('03.storage.oneDay', dayKeys.length === 1, 1, dayKeys.length);
    const rec = dayKeys.length ? s.ls.days[dayKeys[0]] : {};
    check('03.storage.orders', (rec.yw || {}).order === 1 && (rec.sx || {}).order === 1 && (rec.yy || {}).order === 1,
      { yw: 1, sx: 1, yy: 1 }, { yw: rec.yw, sx: rec.sx, yy: rec.yy });
    check('03.storage.times', (rec.yw || {}).times === 1 && (rec.sx || {}).times === 1 && (rec.yy || {}).times === 1, '每科 1 条时间戳', { yw: rec.yw, sx: rec.sx, yy: rec.yy });
    check('03.done.noPageScroll', s.scroll.hasHScroll === false && s.scroll.hasVScroll === false, '无滚动', { h: s.scroll.hasHScroll, v: s.scroll.hasVScroll });
    observe('done', s);
    observe('styleDesktopDone', await evaluate(cdp, sessionId, `(()=>{${H_STYLE} return __style(); })()`));
    await shot('03-cards-done', '点击 3 张卡片后的完成态', DESKTOP);
  });

  /* ---------- 04 完成率统计 tab ---------- */
  await step('04', '切换「完成率统计」tab', async () => {
    await clickSelector(cdp, sessionId, '.tab[data-view="stats"]');
    await waitForExpr(cdp, sessionId, "!document.getElementById('statsView').hidden && document.querySelectorAll('#statsView .tbl tbody tr').length===" + EXPECT_STUDENTS,
      { timeoutMs: 10000, description: '统计表渲染 42 行' });
    await settle();

    const s = await evaluate(cdp, sessionId, exprStats());
    check('04.stats.tabActive', s.statsActive === true && s.checkinActive === false, 'stats tab active', { stats: s.statsActive, checkin: s.checkinActive });
    check('04.stats.panelsHidden', s.panelsHidden === true, true, s.panelsHidden);
    check('04.stats.rowCount', s.rowCount === EXPECT_STUDENTS, EXPECT_STUDENTS, s.rowCount);
    check('04.stats.headerCount', s.headerCount === 9, 9, s.headerCount);
    check('04.stats.headers', s.headers.join('/') === '序号/姓名/语文/数学/英语/道法/历史/总完成率/操作', '序号/姓名/语文/数学/英语/道法/历史/总完成率/操作', s.headers.join('/'));
    check('04.stats.overviewCount', s.overviewCount === 4, 4, s.overviewCount);
    check('04.stats.dayCardCount', s.dayCardCount === 5, '4 概览 + 1 每日记录', s.dayCardCount);
    check('04.stats.firstRowSid', /^[0-9]+$/.test((s.firstRow[0] || '')), '首列为序号数字', s.firstRow[0]);
    check('04.stats.noPageScroll', s.scroll.hasHScroll === false && s.scroll.hasVScroll === false, '无滚动', { h: s.scroll.hasHScroll, v: s.scroll.hasVScroll });
    observe('stats', s);
    await shot('04-stats-tab', '完成率统计 tab', DESKTOP);
  });

  /* ---------- 05 道法历史科目组 ---------- */
  await step('05', '切回清点并切换「道法历史」科目组（2 栏）', async () => {
    await clickSelector(cdp, sessionId, '.tab[data-view="checkin"]');
    await waitForExpr(cdp, sessionId, "!document.getElementById('panels').hidden", { timeoutMs: 8000, description: '回到清点视图' });
    await clickSelector(cdp, sessionId, '.ssw[data-group="soc"]');
    await waitForExpr(cdp, sessionId,
      "(function(){ var w = document.querySelector('.subj-panels.active'); return !!w && w.getAttribute('data-group')==='soc' && w.querySelectorAll('.subj').length===" + EXPECT_SOC_COLUMNS + '; })()',
      { timeoutMs: 8000, description: '道法历史 2 栏渲染' });
    await waitForExpr(cdp, sessionId, "document.querySelectorAll('.subj-panels.leaving-left,.subj-panels.leaving-right').length===0",
      { timeoutMs: 4000, description: '科目组切换动画结束' });
    await settle();

    const s = await evaluate(cdp, sessionId, exprMain());
    check('05.soc.activeGroup', s.activeGroup === 'soc', 'soc', s.activeGroup);
    check('05.soc.columns', s.columns === EXPECT_SOC_COLUMNS, EXPECT_SOC_COLUMNS, s.columns);
    check('05.soc.names', s.names.join('/') === '道法/历史', '道法/历史', s.names.join('/'));
    check('05.soc.cardsPerSubject', s.cardsPerSubject.every((n) => n === EXPECT_STUDENTS), EXPECT_STUDENTS, s.cardsPerSubject);
    check('05.soc.totalCards', s.totalCards === EXPECT_STUDENTS * EXPECT_SOC_COLUMNS, EXPECT_STUDENTS * EXPECT_SOC_COLUMNS, s.totalCards);
    check('05.soc.tiles', s.tiles.total === String(EXPECT_STUDENTS * EXPECT_SOC_COLUMNS) && s.tiles.done === '0' && s.tiles.rate === '0%',
      '84/0/0%', s.tiles.total + '/' + s.tiles.done + '/' + s.tiles.rate);
    check('05.soc.countTexts', s.countTexts.join('|') === '0 / 42|0 / 42', '0 / 42|0 / 42', s.countTexts.join('|'));
    check('05.soc.noPageScroll', s.scroll.hasHScroll === false && s.scroll.hasVScroll === false, '无滚动', { h: s.scroll.hasHScroll, v: s.scroll.hasVScroll });
    observe('soc', s);
    await shot('05-soc-group', '道法历史科目组（2 栏）', DESKTOP);

    // 切回语数英，供后续场景使用
    await clickSelector(cdp, sessionId, '.ssw[data-group="main"]');
    await waitForExpr(cdp, sessionId, "(function(){ var w = document.querySelector('.subj-panels.active'); return !!w && w.getAttribute('data-group')==='main'; })()",
      { timeoutMs: 8000, description: '切回语数英' });
    await sleep(500);
  });

  /* ---------- 06 完成记录弹窗 ---------- */
  await step('06', '「完成记录」弹窗（打开/内容/关闭）', async () => {
    await clickSelector(cdp, sessionId, '#btnHistory');
    await waitForExpr(cdp, sessionId, "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='完成记录'",
      { timeoutMs: 8000, description: '完成记录弹窗打开' });
    await settle();
    const s = await evaluate(cdp, sessionId, exprModal());
    check('06.history.open', s.open === true, true, s.open);
    check('06.history.title', s.title === '完成记录', '完成记录', s.title);
    check('06.history.bodyOverflowHidden', s.inlineBodyOverflow === 'hidden', 'hidden（内联样式）', s.inlineBodyOverflow);
    check('06.history.wide', s.wide === true, true, s.wide);
    check('06.history.dates', s.histDates === 1, 1, s.histDates);
    check('06.history.rows', s.histTblRows === EXPECT_STUDENTS, EXPECT_STUDENTS, s.histTblRows);
    check('06.history.hk', s.histHk === 3, 3, s.histHk);
    check('06.history.sum', /语文/.test(s.histSum) && /数学/.test(s.histSum) && /英语/.test(s.histSum), '含 语文/数学/英语 汇总', s.histSum);
    check('06.history.inViewport', s.modalRect.x >= 0 && s.modalRect.y >= 0 && s.modalRect.bottom <= s.viewport[1] + 1 && (s.modalRect.x + s.modalRect.w) <= s.viewport[0] + 1,
      '弹窗在视口内', s.modalRect);
    observe('historyModal', s);
    await shot('06-history-modal', '完成记录弹窗', DESKTOP);

    await clickByText(cdp, sessionId, '#modalFoot .btn', '关闭');
    await waitForExpr(cdp, sessionId, "document.getElementById('modalMask').hidden===true", { timeoutMs: 5000, description: '完成记录弹窗关闭' });
    check('06.history.close', true, true, true);
    check('06.history.bodyOverflowRestored', (await evaluate(cdp, sessionId, 'document.body.style.overflow')) === '', '内联 overflow 清空', await evaluate(cdp, sessionId, 'document.body.style.overflow'));
  });

  /* ---------- 07 重置弹窗 ---------- */
  await step('07', '「重置」弹窗（打开/选项/ESC 关闭/取消按钮关闭）', async () => {
    await clickSelector(cdp, sessionId, '#btnReset');
    await waitForExpr(cdp, sessionId, "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='重置数据'",
      { timeoutMs: 8000, description: '重置弹窗打开' });
    await settle();
    const s = await evaluate(cdp, sessionId, exprModal());
    check('07.reset.open', s.open === true, true, s.open);
    check('07.reset.title', s.title === '重置数据', '重置数据', s.title);
    check('07.reset.options', s.optCount === 2, 2, s.optCount);
    check('07.reset.defaultToday', s.checkedRadio === 'today', 'today', s.checkedRadio);
    check('07.reset.optOn', s.optOn[0] === true && s.optOn[1] === false, [true, false], s.optOn);
    observe('resetModal', s);
    await shot('07-reset-modal', '重置数据弹窗', DESKTOP);

    // ESC 关闭（若 headless 下 CDP 键盘事件异常，退化为「取消」按钮，保证后续场景可跑）
    let escClosed = true;
    try {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId);
      await waitForExpr(cdp, sessionId, "document.getElementById('modalMask').hidden===true", { timeoutMs: 4000, description: 'ESC 关闭重置弹窗' });
    } catch (e) {
      escClosed = false;
      log('  ESC 未关闭弹窗（' + String(e && e.message).split('\n')[0] + '），改用取消按钮');
      await clickByText(cdp, sessionId, '#modalFoot .btn', '取消');
      await waitForExpr(cdp, sessionId, "document.getElementById('modalMask').hidden===true", { timeoutMs: 4000, description: '取消关闭重置弹窗' });
    }
    check('07.reset.closeByEsc', escClosed, true, escClosed);

    // 再次打开，用「取消」按钮关闭
    await clickSelector(cdp, sessionId, '#btnReset');
    await waitForExpr(cdp, sessionId, "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='重置数据'",
      { timeoutMs: 8000, description: '重置弹窗再次打开' });
    await clickByText(cdp, sessionId, '#modalFoot .btn', '取消');
    await waitForExpr(cdp, sessionId, "document.getElementById('modalMask').hidden===true", { timeoutMs: 4000, description: '取消按钮关闭重置弹窗' });
    check('07.reset.closeByCancel', true, true, true);
  });

  /* ---------- 08 新增学生弹窗 ---------- */
  await step('08', '「新增学生」弹窗（打开/字段/空学号校验/取消关闭）', async () => {
    await clickSelector(cdp, sessionId, '#btnAdd');
    await waitForExpr(cdp, sessionId, "!document.getElementById('modalMask').hidden && document.getElementById('modalTitle').textContent.trim()==='新增学生'",
      { timeoutMs: 8000, description: '新增学生弹窗打开' });
    await settle();
    const s = await evaluate(cdp, sessionId, exprModal());
    check('08.add.open', s.open === true, true, s.open);
    check('08.add.fields', s.addFields[0] === true && s.addFields[1] === true, [true, true], s.addFields);
    check('08.add.buttons', s.footButtons.join('/') === '取消/确认新增', '取消/确认新增', s.footButtons.join('/'));
    observe('addModal', s);
    await shot('08-add-modal', '新增学生弹窗', DESKTOP);

    await clickByText(cdp, sessionId, '#modalFoot .btn', '确认新增');
    await waitForExpr(cdp, sessionId, "(document.getElementById('errSid') || {}).textContent==='请输入学号'", { timeoutMs: 4000, description: '空学号校验提示' });
    check('08.add.validationEmptySid', true, true, true);
    const modalAfter = await evaluate(cdp, sessionId, exprModal());
    check('08.add.stillOpenAfterValidation', modalAfter.open === true, true, modalAfter.open);

    await clickByText(cdp, sessionId, '#modalFoot .btn', '取消');
    await waitForExpr(cdp, sessionId, "document.getElementById('modalMask').hidden===true", { timeoutMs: 4000, description: '取消关闭新增弹窗' });
    check('08.add.close', true, true, true);
    const ls = await evaluate(cdp, sessionId, `(()=>{${H_LS} return __ls(); })()`);
    check('08.add.noMutation', ls.students === EXPECT_STUDENTS, EXPECT_STUDENTS, ls.students);
  });

  /* ---------- 09 搜索 ---------- */
  await step('09', '搜索框过滤（有结果 / 无结果 / 清空还原）', async () => {
    await evaluate(cdp, sessionId, setSearchExpr(SEARCH_QUERY));
    await waitForExpr(cdp, sessionId, "document.querySelectorAll('.subj-panels.active .scard').length===" + (EXPECT_SEARCH_HITS * EXPECT_MAIN_COLUMNS),
      { timeoutMs: 8000, description: '搜索过滤为 9 人 × 3 科' });
    await settle();
    const s = await evaluate(cdp, sessionId, exprSearch());
    check('09.search.query', s.inputValue === SEARCH_QUERY, SEARCH_QUERY, s.inputValue);
    check('09.search.totalCards', s.totalCards === EXPECT_SEARCH_HITS * EXPECT_MAIN_COLUMNS, EXPECT_SEARCH_HITS * EXPECT_MAIN_COLUMNS, s.totalCards);
    check('09.search.cardsPerSubject', s.cardsPerSubject.every((n) => n === EXPECT_SEARCH_HITS), EXPECT_SEARCH_HITS, s.cardsPerSubject);
    check('09.search.countTexts', s.countTexts.join('|') === '1 / 9|1 / 9|1 / 9', '1 / 9|1 / 9|1 / 9（每科已各完成 1 份）', s.countTexts.join('|'));
    check('09.search.tilesUnchanged', s.tiles.total === '126', '126（顶部统计不随过滤变化）', s.tiles.total);
    check('09.search.noBlank', s.blankCount === 0, 0, s.blankCount);
    observe('search', s);
    await shot('09-search', '搜索有结果', DESKTOP);

    await evaluate(cdp, sessionId, setSearchExpr('__NO_MATCH_SID__'));
    await waitForExpr(cdp, sessionId,
      "document.querySelectorAll('.subj-panels.active .scard').length===0 && document.querySelectorAll('.subj-panels.active .blank').length===3",
      { timeoutMs: 8000, description: '搜索无结果空态' });
    const blank = await evaluate(cdp, sessionId, "Array.prototype.map.call(document.querySelectorAll('.subj-panels.active .blank'), function (b) { return b.textContent.trim(); })");
    check('09.search.noMatchBlank', blank.length === 3 && blank.every((t) => /没有匹配/.test(t)), '3 个「没有匹配」空态', blank);

    await evaluate(cdp, sessionId, setSearchExpr(''));
    await waitForExpr(cdp, sessionId, "document.querySelectorAll('.subj-panels.active .scard').length===" + (EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS),
      { timeoutMs: 8000, description: '清空搜索恢复 126 卡' });
    check('09.search.clearRestore', true, true, true);
  });

  /* ---------- 10 移动端 ---------- */
  await step('10', '移动端 390x844 主界面', async () => {
    await setViewport(cdp, sessionId, MOBILE);
    await sleep(450); // resize 防抖 100ms + 布局完成余量
    await settle();
    await waitForExpr(cdp, sessionId, "innerWidth===" + MOBILE.width + " && innerHeight===" + MOBILE.height,
      { timeoutMs: 5000, description: '移动端视口生效' });
    const s = await evaluate(cdp, sessionId, exprMain());
    check('10.mobile.viewport', s.scroll.innerWidth === MOBILE.width && s.scroll.innerHeight === MOBILE.height, MOBILE.width + 'x' + MOBILE.height, s.scroll.innerWidth + 'x' + s.scroll.innerHeight);
    check('10.mobile.columns', s.columns === EXPECT_MAIN_COLUMNS, EXPECT_MAIN_COLUMNS, s.columns);
    check('10.mobile.totalCards', s.totalCards === EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS, EXPECT_STUDENTS * EXPECT_MAIN_COLUMNS, s.totalCards);
    check('10.mobile.noPageScroll', s.scroll.hasHScroll === false && s.scroll.hasVScroll === false, '无页面滚动', { h: s.scroll.hasHScroll, v: s.scroll.hasVScroll });
    check('10.mobile.boardInViewport', !!s.layout.board && s.layout.board.bottom <= s.scroll.innerHeight + 1, 'board.bottom<=844', s.layout.board && s.layout.board.bottom);
    check('10.mobile.subjectsVisible', (s.layout.subjects || []).length === 3 && s.layout.subjects.every((x) => x.box && x.box.w > 60), '3 栏可见', (s.layout.subjects || []).map((x) => x.box && x.box.w + 'x' + x.box.h));
    observe('mobile', s);
    await shot('10-mobile', '移动端主界面 390x844', MOBILE);
  });
}

/* ============================== 入口 ============================== */

async function main() {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error('[参数错误] ' + e.message); printHelp(); process.exitCode = 2; return; }
  if (opts.help) { printHelp(); return; }
  label = opts.label;
  outDir = path.join(VERIFY_DIR, label);

  if (!fs.existsSync(opts.html)) { console.error('[错误] 找不到主 HTML: ' + opts.html); process.exitCode = 2; return; }
  if (!fs.existsSync(opts.xlsx)) { console.error('[错误] 找不到示例名单 xlsx: ' + opts.xlsx); process.exitCode = 2; return; }

  sourceInfo = { bytes: fs.statSync(opts.html).size, mtime: fs.statSync(opts.html).mtime.toISOString() };
  sourceHashBefore = sha256File(opts.html);
  log('WS_ROOT = ' + WS_ROOT);
  log('主 HTML = ' + opts.html + '（sha256 ' + sourceHashBefore.slice(0, 12) + ', ' + sourceInfo.bytes + 'B）');
  log('示例名单 = ' + opts.xlsx);
  log('输出目录 = ' + outDir + '，视口 ' + DESKTOP.width + 'x' + DESKTOP.height + ' + ' + MOBILE.width + 'x' + MOBILE.height);

  if (opts.dryRun) {
    const v = validateInjectedExpressions();
    if (v.errors.length) {
      console.error('[错误] 注入页面的表达式存在语法错误:');
      v.errors.forEach((e) => console.error('  - ' + e.name + ': ' + e.error));
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({
      dryRun: true,
      ok: true,
      label,
      outDir,
      html: opts.html,
      xlsx: opts.xlsx,
      edge: opts.edge || process.env.EDGE_BIN || '(auto)',
      viewports: { desktop: DESKTOP, mobile: MOBILE },
      expectations: { students: EXPECT_STUDENTS, mainColumns: EXPECT_MAIN_COLUMNS, socColumns: EXPECT_SOC_COLUMNS, searchQuery: SEARCH_QUERY, searchHits: EXPECT_SEARCH_HITS },
      injectedExpressions: { count: v.count, ok: true },
      note: 'dry-run 仅校验参数/文件/注入表达式语法，未启动 Edge',
    }, null, 2));
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  // 提前打印场景清单，便于 Lead 在长任务中判断进度
  log('场景: 00 setup → 01 空状态 → 02 导入主界面 → 03 完成态 → 04 统计 tab → 05 道法历史 → 06 完成记录 → 07 重置 → 08 新增 → 09 搜索 → 10 移动端');

  try {
    await runScenarios();
  } catch (e) {
    runError = e;
    log('场景中断: ' + String((e && e.stack) || e).split('\n')[0]);
  } finally {
    try { if (cdp) cdp.close(); } catch (_) { /* ignore */ }
    try { if (edge) { log('关闭 Edge（taskkill 进程树）'); edge.close(); } } catch (_) { /* ignore */ }
    await sleep(300);
  }

  const durationMs = Date.now() - t0;

  // 控制台/异常在写报告前汇总，确保进入 knownIssues 与 baseline.json
  const consoleCounts = recorder ? recorder.summary() : { total: 0, errors: 0, warnings: 0 };
  if (consoleCounts.errors > 0) knownIssues.push({ id: 'console-errors', text: '存在 ' + consoleCounts.errors + ' 条页面错误，见 console-' + label + '.json' });
  if (consoleCounts.warnings > 0) knownIssues.push({ id: 'console-warnings', text: '存在 ' + consoleCounts.warnings + ' 条页面警告，见 console-' + label + '.json' });
  if (sourceHashBefore && fs.existsSync(opts.html) && sha256File(opts.html) !== sourceHashBefore) {
    knownIssues.push({ id: 'source-changed-during-run', text: '运行期间主 HTML 被修改，本次基线可能混入修改，建议重跑' });
  }

  const report = buildReport(startedAt, durationMs);
  let baselineFile = null;
  try { baselineFile = writeOutputs(report, startedAt); } catch (e) { console.error('[错误] 写报告失败: ' + e.message); }

  const c = report.console.counts;
  log('控制台: exceptions/console errors=' + c.errors + '，warnings=' + c.warnings + '（详见 console-' + label + '.json）');

  console.log('');
  console.log('==================== RESULT ' + label + ' ====================');
  console.log('耗时: ' + fmtDuration(durationMs));
  console.log('截图: ' + screenshots.length + ' 张 → ' + path.relative(process.cwd(), outDir));
  screenshots.forEach((s) => console.log('  - ' + s.file + '  ' + s.width + 'x' + s.height + '  ' + Math.round(s.bytes / 1024) + 'KB  (' + s.title + ')'));
  console.log('断言: ' + assertions.filter((a) => a.ok).length + ' 通过 / ' + failed + ' 失败 / 共 ' + assertions.length + ' 条');
  console.log('边缘断言: edge=' + report.env.edgeVersion + '，源码 hash 运行中稳定=' + report.source.stableDuringRun);
  console.log('');
  console.log('=== ASSERTIONS JSON ===');
  console.log(JSON.stringify({
    label,
    ok: runError === null && failed === 0 && report.source.stableDuringRun,
    runError: report.runError,
    failedAssertions: assertions.filter((a) => !a.ok).map((a) => ({ name: a.name, expected: a.expected, actual: a.actual })),
    console: report.console.counts,
    knownIssues,
    baselineFile: baselineFile ? path.relative(VERIFY_DIR, baselineFile) : null,
  }, null, 2));

  if (runError !== null || failed > 0) process.exitCode = 1;
}

// Ctrl+C 时也要杀掉 Edge 进程树
function emergencyKill() {
  try { if (edge) edge.close(); } catch (_) { /* ignore */ }
}
process.on('SIGINT', () => { log('收到 SIGINT，清理 Edge'); emergencyKill(); process.exit(130); });
process.on('SIGTERM', () => { log('收到 SIGTERM，清理 Edge'); emergencyKill(); process.exit(143); });

main().catch((e) => {
  console.error('[未捕获错误] ' + ((e && e.stack) || e));
  emergencyKill();
  process.exitCode = 1;
});
