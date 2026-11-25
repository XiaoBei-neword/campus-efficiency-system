'use strict';
/**
 * static-check.js — 纯静态检查主 HTML（不需要浏览器），用于改版前后自查
 *
 * 用法：
 *   node static-check.js --label before
 *   node static-check.js --label after
 *   node static-check.js --label after --json
 *
 * 检查项：
 *   a. <style>/<script> 位置、CSS 花括号配平、app JS 粗糙花括号配平
 *   b. live CSS class 覆盖率：HTML class 属性 + JS 模板/className/classList 提取，对比 CSS 选择器
 *   c. 旧配色残留检测（#12385a/#1a5b8d/... 等），区分 :root 主题 token 允许项
 *   d. 内联样式清单（style="..."），分类为「会被新主题覆盖的视觉样式」/「必须保留的布局动态样式」
 *   e. CSS 是否仍消费 JS 注入的 --sw / --sh（单屏铺满布局依赖）
 *
 * 产物：.workbuddy/verify/static-check-<label>.json + .md
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERIFY_DIR = __dirname;
const WS_ROOT = path.resolve(process.env.WS_ROOT || path.join(__dirname, '..', '..'));
const DEFAULT_HTML = path.join(WS_ROOT, '在校高效系统v0.2.1.html');

/* 改版前旧配色（Lead 指定重点排查） */
const OLD_PALETTE = ['#12385a', '#1a5b8d', '#0f2740', '#14476f', '#c62828', '#16a34a', '#12813f', '#e0a13a', '#f1f5f9', '#ffffff'];

/* 动态拼接 / 运行时参数类：静态不可判定，不作为「死类」 */
const DYNAMIC_WHITELIST = new Set([
  'good', 'bad', 'out', 'done', 'active', 'on', 'tiny', 'pop', 'wide', 'drag', 'more',
  'ok', 'dim', 'hi', 'just', 'full', 'hd', 'btn-danger',
  'sb1', 'sb2', 'sb3', 'sb4', 'sb5', 'r1', 'r2', 'r3', 'r4', 'r5',
  'leaving-left', 'leaving-right', 'prep-left', 'prep-right',
]);

/* 旧版 #grid 卡片体系的疑似遗留 class（v0.2.1 已换成 .subj/.scard 体系） */
const LEGACY_GRID_CLASSES = new Set([
  'grid', 'card', 'card-head', 'card-mid', 'sid', 'del', 'state', 'dot', 'rank',
  'rate', 'lbl', 'rate-track', 'rate-val', 'full', 'just', 'anim',
  'r1', 'r2', 'r3', 'r4', 'r5', 'pill', 'yes', 'no',
  'nm', 'seq', 'st-time', 'no-rate', 'no-time', 'no-state',
]);

/* ============================== 小工具 ============================== */

function parseArgs(argv) {
  const opts = { label: 'before', html: DEFAULT_HTML, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error('参数 ' + a + ' 缺少取值');
      return v;
    };
    if (a === '--label' || a === '--out') opts.label = next();
    else if (a === '--html') opts.html = path.resolve(next());
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error('未知参数: ' + a);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(opts.label)) throw new Error('--label 只允许字母数字/点/下划线/中划线');
  return opts;
}

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function makeLineAt(starts) {
  return function lineAt(offset) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

function normalizeHex(hex) {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h;
}

function snippetOf(lineText, max) {
  return String(lineText || '').trim().replace(/\s+/g, ' ').slice(0, max || 150);
}

/** 找 <style> 块（含位置与内容）——注意排除 SheetJS/FODS 字符串里的 <style:...>、<styleSheet> */
function findStyleBlocks(text) {
  const blocks = [];
  const openRe = /<style(?=[\s>])/g;
  let m;
  while ((m = openRe.exec(text))) {
    const open = m.index;
    const openEnd = text.indexOf('>', open);
    if (openEnd < 0) break;
    const close = text.indexOf('</style>', openEnd);
    if (close < 0) { blocks.push({ open, openEnd, close: null, unclosed: true, css: text.slice(openEnd + 1) }); break; }
    blocks.push({ open, openEnd, close, unclosed: false, css: text.slice(openEnd + 1, close) });
    openRe.lastIndex = close + 8;
  }
  return blocks;
}

/** 找 <script> 块 */
function findScriptBlocks(text) {
  const blocks = [];
  const openRe = /<script(?=[\s>])/g;
  let m;
  while ((m = openRe.exec(text))) {
    const open = m.index;
    const openEnd = text.indexOf('>', open);
    if (openEnd < 0) break;
    const close = text.indexOf('</script>', openEnd);
    if (close < 0) { blocks.push({ open, openEnd, close: null, unclosed: true, js: text.slice(openEnd + 1) }); break; }
    blocks.push({ open, openEnd, close, unclosed: false, js: text.slice(openEnd + 1, close) });
    openRe.lastIndex = close + 9;
  }
  return blocks;
}

/** 注释替换为空格（保持长度/换行不变，便于行号定位） */
function stripCssComments(css) {
  const chars = css.split('');
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      let j = css.indexOf('*/', i + 2);
      if (j < 0) j = css.length;
      for (let k = i; k < Math.min(j + 2, css.length); k++) if (chars[k] !== '\n') chars[k] = ' ';
      i = j + 2;
    } else i++;
  }
  return chars.join('');
}

/* ============================== CSS 分析 ============================== */

function analyzeCss(css, absStart, lineAt) {
  const stripped = stripCssComments(css);
  const selectors = [];
  const atRules = [];
  const classes = new Map(); // name -> [{line, selector}]
  const customProps = [];
  const important = [];

  let depth = 0;
  let bufStart = 0;
  const braceStack = [];
  const balanced = { open: 0, close: 0, ok: true, firstNegativeLine: null, minDepth: 0 };

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      balanced.open++;
      const prelude = stripped.slice(bufStart, i).trim();
      const absOffset = absStart + i;
      const line = lineAt(absOffset);
      if (prelude.startsWith('@')) {
        atRules.push({ text: snippetOf(prelude, 160), line });
        braceStack.push({ kind: 'at', startAbs: absOffset, depth });
      } else if (prelude) {
        selectors.push({ text: snippetOf(prelude, 300), line, depth });
        braceStack.push({ kind: 'rule', startAbs: absOffset, depth, selector: prelude });
        const re = /\.(-?[_a-zA-Z][\w-]*)/g;
        let m;
        while ((m = re.exec(prelude))) {
          const name = m[1];
          if (!classes.has(name)) classes.set(name, []);
          classes.get(name).push({ line, selector: snippetOf(prelude, 120) });
        }
        const cpRe = /(--[A-Za-z0-9-]+)\s*:/g;
        while ((m = cpRe.exec(prelude))) customProps.push({ name: m[1], line, kind: 'definitionPrelude', selector: snippetOf(prelude, 100) });
      }
      depth++;
      bufStart = i + 1;
    } else if (ch === '}') {
      balanced.close++;
      depth--;
      if (depth < balanced.minDepth) balanced.minDepth = depth;
      if (depth < 0 && balanced.firstNegativeLine === null) balanced.firstNegativeLine = lineAt(absStart + i);
      bufStart = i + 1;
    } else if (ch === ';' && depth === 0) {
      bufStart = i + 1;
    } else if (ch === '!') {
      if (stripped.slice(i, i + 10).toLowerCase() === '!important') {
        important.push({ line: lineAt(absStart + i), snippet: snippetOf(stripped.slice(i, i + 40), 40) });
      }
    }
  }
  if (depth !== 0) balanced.ok = false;

  // :root 块区间（用于判断「主题 token 允许项」）
  const rootRanges = [];
  const rootRe = /:root\b/;
  for (const sel of selectors) {
    if (!rootRe.test(sel.text)) continue;
    // 从选择器所在 { 找匹配 }
    const braceAbs = stripped.indexOf('{', Math.max(0, stripped.indexOf(sel.text)));
    if (braceAbs < 0) continue;
    let d = 0, endAbs = -1;
    for (let i = braceAbs; i < stripped.length; i++) {
      if (stripped[i] === '{') d++;
      else if (stripped[i] === '}') { d--; if (d === 0) { endAbs = i; break; } }
    }
    if (endAbs > braceAbs) rootRanges.push({ startAbs: absStart + braceAbs, endAbs: absStart + endAbs });
  }

  // 变量定义（declaration）
  const declRe = /(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g;
  const deffedVars = new Map();
  let dm;
  while ((dm = declRe.exec(stripped))) {
    const line = lineAt(absStart + dm.index);
    if (!deffedVars.has(dm[1])) deffedVars.set(dm[1], []);
    deffedVars.get(dm[1]).push({ line, value: snippetOf(dm[2], 60) });
  }

  return {
    selectors, atRules, classes, customProps, important, balanced, rootRanges,
    variableDefinitions: deffedVars,
    ruleCount: selectors.length,
    byteLength: css.length,
  };
}

/* ============================== HTML/JS class 提取 ============================== */

const CLASS_ATTR_DQ = /class\s*=\s*"([^"'\n]{0,300})/g;
const CLASS_ATTR_SQ = /class\s*=\s*'([^"'\n]{0,300})/g;
const CLASSNAME_LITERAL = /\b(className|cls)\s*=\s*(['"])([^'"]{0,200})\2/g;
const CLASSLIST_LITERAL = /classList\.(add|remove|toggle)\(\s*(['"])([^'"]{1,160})\2/g;
const CLASSLIST_TERNARY = /classList\.(add|remove|toggle)\(([^)]{0,300})\)/g;
const QUOTED_TOKEN = /'([^']{1,120})'|"([^"]{1,120})"/g;
const COMPARISON_BEFORE_QUOTE = /(?:===|!==|==|!=)\s*$/;

function extractClassesFrom(source, into) {
  const push = (raw) => {
    if (!raw) return;
    for (const token of String(raw).split(/\s+/)) {
      if (!token) continue;
      if (!/^-?[_a-zA-Z][\w-]*$/.test(token)) continue;
      into.add(token);
    }
  };
  let m;
  CLASS_ATTR_DQ.lastIndex = 0;
  while ((m = CLASS_ATTR_DQ.exec(source))) push(m[1]);
  CLASS_ATTR_SQ.lastIndex = 0;
  while ((m = CLASS_ATTR_SQ.exec(source))) push(m[1]);
  CLASSNAME_LITERAL.lastIndex = 0;
  while ((m = CLASSNAME_LITERAL.exec(source))) push(m[3]);

  // classList.add/remove/toggle('literal', ...) —— 只取第一个（class 名）参数
  const seenArgs = new Set();
  CLASSLIST_LITERAL.lastIndex = 0;
  while ((m = CLASSLIST_LITERAL.exec(source))) {
    seenArgs.add(m[0]);
    push(m[3]);
  }
  // classList.add(dir > 0 ? 'a' : 'b') —— 从参数里的引号字面量提取，但排除比较表达式右侧
  CLASSLIST_TERNARY.lastIndex = 0;
  while ((m = CLASSLIST_TERNARY.exec(source))) {
    const args = m[2];
    let q;
    QUOTED_TOKEN.lastIndex = 0;
    while ((q = QUOTED_TOKEN.exec(args))) {
      const before = args.slice(Math.max(0, q.index - 8), q.index);
      if (COMPARISON_BEFORE_QUOTE.test(before)) continue; // picked === 'today' 之类，不是 class
      push(q[1] || q[2]);
    }
  }
  return into;
}

/* ============================== 颜色 / 内联样式 ============================== */

const HEX_RE = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/g;

function analyzeColors(text, lineAt, regionAt, rootRanges) {
  const paletteSet = new Set(OLD_PALETTE.map(normalizeHex));
  const paletteHits = [];
  const inventory = new Map(); // normalized -> {count, css, js, html, firstLine, sample}
  let rgbCount = 0, hslCount = 0;
  let m;
  while ((m = HEX_RE.exec(text))) {
    const raw = m[0];
    const norm = normalizeHex(raw);
    const line = lineAt(m.index);
    const region = regionAt(m.index);
    const lineText = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index) < 0 ? text.length : text.indexOf('\n', m.index));
    const themeToken = rootRanges.some((r) => m.index >= r.startAbs && m.index <= r.endAbs) && /--[A-Za-z0-9-]+\s*:/.test(lineText);
    const hit = { raw, normalized: norm, line, region, themeToken, offset: m.index, lineText: snippetOf(lineText, 160) };
    if (paletteSet.has(norm)) paletteHits.push(hit);
    if (!inventory.has(norm)) inventory.set(norm, { count: 0, css: 0, js: 0, html: 0, firstLine: line, sample: snippetOf(lineText, 120) });
    const inv = inventory.get(norm);
    inv.count++;
    inv[region] = (inv[region] || 0) + 1;
  }
  HEX_RE.lastIndex = 0;
  const rgbRe = /\brgba?\(/g;
  while ((m = rgbRe.exec(text))) rgbCount++;
  const hslRe = /\bhsla?\(/g;
  while ((m = hslRe.exec(text))) hslCount++;

  const palette = OLD_PALETTE.map((p) => {
    const norm = normalizeHex(p);
    const hits = paletteHits.filter((h) => h.normalized === norm);
    return {
      color: p,
      normalized: norm,
      total: hits.length,
      css: hits.filter((h) => h.region === 'css').length,
      js: hits.filter((h) => h.region === 'js').length,
      html: hits.filter((h) => h.region === 'html').length,
      themeToken: hits.filter((h) => h.themeToken).length,
      residue: hits.filter((h) => !h.themeToken).length,
      hits: hits.slice(0, 40),
    };
  });

  const inventoryArr = [...inventory.entries()].map(([norm, v]) => ({ color: norm, ...v })).sort((a, b) => b.count - a.count);

  return {
    palette,
    paletteResidueTotal: palette.reduce((s, p) => s + p.residue, 0),
    paletteThemeTokenTotal: palette.reduce((s, p) => s + p.themeToken, 0),
    paletteTotal: paletteHits.length,
    rgbCount, hslCount,
    uniqueHexCount: inventory.size,
    inventory: inventoryArr,
  };
}

/**
 * 抽取 style="..." 内联样式。
 * @param {string} text 待扫描文本（或整文件、或脚本片段）
 * @param {number} baseOffset 文本在整文件中的起始偏移（用于行号/区域判定）
 * @param {string} region 'html' | 'js'
 */
function analyzeInlineStyles(text, baseOffset, region, lineAt) {
  const items = [];
  const re = /style\s*=\s*"([^"\n]{0,500})"/g;
  let m;
  while ((m = re.exec(text))) {
    const cssText = m[1];
    const absOffset = baseOffset + m.index;
    // 只保留像 CSS 声明列表的内容（排除 XML 里的 style="thin" 这类）
    if (!/[-\w]+\s*:\s*[^;\s]/.test(cssText)) continue;
    const line = lineAt(absOffset);
    const keys = (cssText.match(/[-\w]+\s*:/g) || []).map((s) => s.replace(/\s*:$/, ''));
    const hexes = (cssText.match(HEX_RE) || []);
    const flags = {
      hasColor: /(^|;)\s*(color|background|background-color|border-color|fill|stroke)\s*:/.test(cssText),
      hasBackground: /background(-image|-color)?\s*:/.test(cssText),
      hasGradient: /gradient\(/.test(cssText),
      hasShadow: /box-shadow|text-shadow/.test(cssText),
      hasRadius: /border-radius/.test(cssText),
      hasBorder: /(^|;)\s*border/.test(cssText),
      hasWidth: /(^|;)\s*width\s*:/.test(cssText),
      hasHeight: /(^|;)\s*height\s*:/.test(cssText),
      hasTransform: /transform/.test(cssText),
      hasLayout: /(^|;)\s*(margin|padding|display|flex|grid|gap|position|top|left|right|bottom|overflow|align|justify|text-align|vertical-align)\b/.test(cssText),
      hasAccent: /accent-color/.test(cssText),
    };
    const visual = flags.hasColor || flags.hasBackground || flags.hasGradient || flags.hasShadow || flags.hasRadius || flags.hasBorder || flags.hasAccent;
    const layout = flags.hasWidth || flags.hasHeight || flags.hasTransform || flags.hasLayout;
    items.push({
      line,
      region,
      cssText,
      keys,
      hexColors: hexes,
      flags,
      classify: visual ? 'visual-overridable（新主题应接管/可移除）' : (layout ? 'layout-dynamic（布局/度量，需保留）' : 'other'),
    });
  }
  return items;
}

function analyzeJsStyleAssignments(appJs, baseOffset, lineAt) {
  const jsStyles = [];
  const re = /\.style\.([A-Za-z]+)\s*=\s*([^;]{0,120});/g;
  let m;
  while ((m = re.exec(appJs))) {
    jsStyles.push({ line: lineAt(baseOffset + m.index), prop: m[1], value: snippetOf(m[2], 100) });
  }
  return jsStyles;
}

/* ============================== 主流程 ============================== */

function analyze(htmlPath, label) {
  const text = fs.readFileSync(htmlPath, 'utf8');
  const starts = buildLineIndex(text);
  const lineAt = makeLineAt(starts);
  const styleBlocks = findStyleBlocks(text);
  const scriptBlocks = findScriptBlocks(text);
  const fileLines = starts.length;
  const fileHash = sha256(text);

  // 区域判定
  const cssRanges = styleBlocks.filter((b) => !b.unclosed).map((b) => ({ startAbs: b.openEnd + 1, endAbs: b.close }));
  const jsRanges = scriptBlocks.filter((b) => !b.unclosed).map((b) => ({ startAbs: b.openEnd + 1, endAbs: b.close }));
  const regionAt = (offset) => {
    for (const r of cssRanges) if (offset >= r.startAbs && offset <= r.endAbs) return 'css';
    for (const r of jsRanges) if (offset >= r.startAbs && offset <= r.endAbs) return 'js';
    return 'html';
  };

  // CSS 汇总（逐块分析，行号换算为全局行号）
  const styleBlocksAll = styleBlocks;
  const blockStartLines = styleBlocks.map((b) => lineAt(b.openEnd + 1));
  const cssMerged = {
    selectors: [], atRules: [], classes: new Map(), customProps: [], important: [],
    balanced: { open: 0, close: 0, ok: true, firstNegativeLine: null, minDepth: 0 },
    rootRanges: [], variableDefinitions: new Map(), ruleCount: 0, byteLength: 0,
  };
  styleBlocks.forEach((b, i) => {
    const startLine = blockStartLines[i];
    const lineAtAbs = (offsetInBlock) => startLine + (text.slice(b.openEnd + 1, b.openEnd + 1 + offsetInBlock).match(/\n/g) || []).length;
    // 用绝对偏移换算更准：lambda 接收块内偏移
    const toAbs = (o) => b.openEnd + 1 + o;
    const lineAtBlock = (o) => lineAt(toAbs(o));
    const r = analyzeCss(b.css, 0, lineAtBlock); // absStart 传 0：lineAtBlock 自己换算绝对行号
    cssMerged.selectors.push(...r.selectors);
    cssMerged.atRules.push(...r.atRules);
    r.classes.forEach((v, k) => {
      if (!cssMerged.classes.has(k)) cssMerged.classes.set(k, []);
      cssMerged.classes.get(k).push(...v);
    });
    cssMerged.customProps.push(...r.customProps);
    cssMerged.important.push(...r.important);
    cssMerged.ruleCount += r.ruleCount;
    cssMerged.byteLength += r.byteLength;
    cssMerged.balanced.open += r.balanced.open;
    cssMerged.balanced.close += r.balanced.close;
    if (!r.balanced.ok) cssMerged.balanced.ok = false;
    if (r.balanced.firstNegativeLine !== null && cssMerged.balanced.firstNegativeLine === null) cssMerged.balanced.firstNegativeLine = r.balanced.firstNegativeLine;
    r.rootRanges.forEach((rr) => cssMerged.rootRanges.push({ startAbs: toAbs(rr.startAbs), endAbs: toAbs(rr.endAbs) }));
    r.variableDefinitions.forEach((arr, k) => {
      if (!cssMerged.variableDefinitions.has(k)) cssMerged.variableDefinitions.set(k, []);
      cssMerged.variableDefinitions.get(k).push(...arr);
    });
  });
  cssMerged.balanced.ok = cssMerged.balanced.ok && cssMerged.balanced.open === cssMerged.balanced.close;

  // app JS 区块（含 `if (window.__NO_SUPPORT__) return;` 的那段）
  const appMarker = 'if (window.__NO_SUPPORT__) return;';
  const appMarkerAbs = text.indexOf(appMarker);
  const appScript = appMarkerAbs >= 0 ? (scriptBlocks.find((b) => appMarkerAbs >= b.openEnd && appMarkerAbs <= (b.close == null ? text.length : b.close)) || null) : null;

  // HTML 标记区域（空掉 style/script 内容）
  const mask = new Array(text.length).fill(' ');
  for (let i = 0; i < text.length; i++) mask[i] = text[i] === '\n' ? '\n' : ' ';
  for (const b of cssRanges) for (let i = b.startAbs; i <= b.endAbs; i++) mask[i] = text[i] === '\n' ? '\n' : ' ';
  // 先复制非 CSS 区，再空掉 script
  for (const b of jsRanges) for (let i = b.startAbs; i <= b.endAbs; i++) mask[i] = text[i] === '\n' ? '\n' : ' ';
  const markup = mask.join('');
  // 用原文本替换出 markup 内容（mask 里非 CSS/JS 区保留原文）
  const markupChars = text.split('');
  for (let i = 0; i < text.length; i++) {
    const inCss = cssRanges.some((r) => i >= r.startAbs && i <= r.endAbs);
    const inJs = jsRanges.some((r) => i >= r.startAbs && i <= r.endAbs);
    markupChars[i] = inCss || inJs ? (text[i] === '\n' ? '\n' : ' ') : text[i];
  }
  const markupText = markupChars.join('');
  const appJs = appScript ? appScript.js : '';

  // class 使用集合
  const htmlClasses = extractClassesFrom(markupText, new Set());
  const jsClasses = extractClassesFrom(appJs, new Set());
  const usedClasses = new Set([...htmlClasses, ...jsClasses]);
  const definedClasses = new Set(cssMerged.classes.keys());
  const missingClasses = [...usedClasses].filter((c) => !definedClasses.has(c)).sort();
  const missingWithPrefixes = missingClasses.map((c) => ({
    name: c,
    dynamicPrefix: [...definedClasses].filter((d) => d.startsWith(c) && d !== c).slice(0, 5),
  }));
  const deadClasses = [...definedClasses].filter((c) => !usedClasses.has(c) && !DYNAMIC_WHITELIST.has(c)).sort();
  const deadLegacy = deadClasses.filter((c) => LEGACY_GRID_CLASSES.has(c));
  const deadOther = deadClasses.filter((c) => !LEGACY_GRID_CLASSES.has(c));
  const whitelistUnreferenced = [...definedClasses].filter((c) => !usedClasses.has(c) && DYNAMIC_WHITELIST.has(c)).sort();

  // 颜色
  const colors = analyzeColors(text, lineAt, regionAt, cssMerged.rootRanges);
  // 内联样式：只扫描静态 HTML 标记区 + app JS，避免 SheetJS/FODS 生成 XML 的 style 属性噪声
  const inlineItems = analyzeInlineStyles(markupText, 0, 'html', lineAt)
    .concat(appScript ? analyzeInlineStyles(appJs, appScript.openEnd + 1, 'js', lineAt) : []);
  const inline = { items: inlineItems, jsStyles: appScript ? analyzeJsStyleAssignments(appJs, appScript.openEnd + 1, lineAt) : [] };

  // --sw/--sh
  const cssAll = styleBlocks.map((b) => b.css).join('\n');
  const varSwSh = {
    cssVarUsage: (cssAll.match(/var\(\s*--sw\s*\)/g) || []).length,
    cssVarUsageSh: (cssAll.match(/var\(\s*--sh\s*\)/g) || []).length,
    jsSetPropertySw: (appJs.match(/setProperty\(\s*['"]--sw['"]/g) || []).length,
    jsSetPropertySh: (appJs.match(/setProperty\(\s*['"]--sh['"]/g) || []).length,
  };
  varSwSh.ok = varSwSh.cssVarUsage > 0 && varSwSh.cssVarUsageSh > 0 && varSwSh.jsSetPropertySw > 0 && varSwSh.jsSetPropertySh > 0;

  // CSS 变量使用统计
  const varUsage = new Map();
  let vm;
  const useRe = /var\(\s*(--[A-Za-z0-9-]+)/g;
  while ((vm = useRe.exec(cssAll))) varUsage.set(vm[1], (varUsage.get(vm[1]) || 0) + 1);
  const unusedVars = [...cssMerged.variableDefinitions.keys()].filter((k) => !varUsage.has(k)).sort();

  // app JS 粗糙花括号配平（跳过 SheetJS；字符串/注释里的花括号可能干扰，标注为 heuristic）
  const jsBraces = { open: (appJs.match(/\{/g) || []).length, close: (appJs.match(/\}/g) || []).length };
  jsBraces.balanced = jsBraces.open === jsBraces.close;

  // <style>/<script> 标签位置
  const tags = {
    styleTags: styleBlocks.map((b) => ({
      openLine: lineAt(b.open), closeLine: b.close == null ? null : lineAt(b.close), bytes: b.css.length,
    })),
    scriptTags: scriptBlocks.map((b) => ({
      openLine: lineAt(b.open), closeLine: b.close == null ? null : lineAt(b.close), bytes: b.js.length,
      isSheetJs: /xlsx\.js|SheetJS/.test(b.js.slice(0, 400)),
      isApp: b === appScript,
    })),
  };

  // 结论汇总
  const summary = {
    file: {
      path: htmlPath,
      label,
      sha256: fileHash,
      bytes: Buffer.byteLength(text, 'utf8'),
      lines: fileLines,
      styleBlocks: styleBlocks.length,
      scriptBlocks: scriptBlocks.length,
    },
    structure: {
      styleTags: tags.styleTags,
      scriptTags: tags.scriptTags,
      cssBraces: cssMerged.balanced,
      appJsBraces: jsBraces,
      cssRules: cssMerged.ruleCount,
      cssBytes: cssMerged.byteLength,
      importantCount: cssMerged.important.length,
      mediaQueries: cssMerged.atRules.filter((a) => /@media/.test(a.text)),
    },
    classes: {
      definedCount: definedClasses.size,
      usedCount: usedClasses.size,
      htmlUsedCount: htmlClasses.size,
      jsUsedCount: jsClasses.size,
      missingStyleForUsed: missingWithPrefixes,
      deadLegacy,
      deadOther,
      whitelistUnreferenced,
      coverage: {
        definedCoveredByUsage: definedClasses.size - deadClasses.length - whitelistUnreferenced.length,
        definedTotal: definedClasses.size,
        usedWithStyle: [...usedClasses].filter((c) => definedClasses.has(c)).length,
        usedTotal: usedClasses.size,
      },
      definitions: [...cssMerged.classes.entries()].map(([name, refs]) => ({ name, lines: [...new Set(refs.map((r) => r.line))] })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    colors: {
      oldPalette: colors.palette,
      oldPaletteResidueTotal: colors.paletteResidueTotal,
      oldPaletteThemeTokenTotal: colors.paletteThemeTokenTotal,
      oldPaletteTotal: colors.paletteTotal,
      rgbCount: colors.rgbCount,
      hslCount: colors.hslCount,
      uniqueHexCount: colors.uniqueHexCount,
      inventoryTop30: colors.inventory.slice(0, 30),
      themeTokens: [...cssMerged.variableDefinitions.entries()].map(([name, defs]) => ({ name, defs })).sort((a, b) => a.name.localeCompare(b.name)),
      unusedThemeVars: unusedVars,
    },
    inlineStyles: {
      count: inline.items.length,
      visualOverridable: inline.items.filter((i) => i.classify.startsWith('visual')).length,
      layoutDynamic: inline.items.filter((i) => i.classify.startsWith('layout')).length,
      items: inline.items,
      jsStyleAssignments: inline.jsStyles,
    },
    injectedVars: varSwSh,
    knownDeadHints: LEGACY_GRID_CLASSES.size,
  };

  return summary;
}

/* ============================== 报告输出 ============================== */

function toMarkdown(r) {
  const L = [];
  const P = (s) => L.push(s);
  P('# 静态检查报告 · ' + r.file.label);
  P('');
  P('- 文件：`' + r.file.path + '`');
  P('- 大小：' + r.file.bytes + ' B，' + r.file.lines + ' 行，sha256 `' + r.file.sha256.slice(0, 16) + '…`');
  P('- 生成时间：' + new Date().toISOString());
  P('');
  P('## a. 结构与花括号配平');
  P('');
  P('| 项 | 值 |');
  P('| --- | --- |');
  P('| `<style>` 块数 | ' + r.file.styleBlocks + ' |');
  P('| `<script>` 块数 | ' + r.file.scriptBlocks + ' |');
  r.structure.styleTags.forEach((t, i) => P('| style#' + (i + 1) + ' 行 | ' + t.openLine + ' ~ ' + t.closeLine + '（' + t.bytes + ' B） |'));
  r.structure.scriptTags.forEach((t, i) => P('| script#' + (i + 1) + ' 行 | ' + t.openLine + ' ~ ' + t.closeLine + '（' + t.bytes + ' B）' + (t.isSheetJs ? ' SheetJS' : '') + (t.isApp ? ' **app**' : '') + ' |'));
  P('| CSS 花括号 | open=' + r.structure.cssBraces.open + ', close=' + r.structure.cssBraces.close + ', **配平=' + (r.structure.cssBraces.ok ? 'OK' : 'FAIL') + '** |');
  P('| app JS 花括号(启发式) | open=' + r.structure.appJsBraces.open + ', close=' + r.structure.appJsBraces.close + ', **配平=' + (r.structure.appJsBraces.balanced ? 'OK' : 'FAIL') + '** |');
  P('| CSS 规则数 / 字节 | ' + r.structure.cssRules + ' / ' + r.structure.cssBytes + ' |');
  P('| `!important` 数 | ' + r.structure.importantCount + ' |');
  P('');
  P('媒体查询：' + (r.structure.mediaQueries.length ? r.structure.mediaQueries.map((m) => '`' + m.text + '`@' + m.line).join('、') : '无'));
  P('');
  P('## b. live CSS class 覆盖率');
  P('');
  P('- CSS 定义 class：**' + r.classes.definedCount + '**；HTML/JS 使用 class：**' + r.classes.usedCount + '**（HTML ' + r.classes.htmlUsedCount + ' / JS ' + r.classes.jsUsedCount + '）');
  P('- 使用中且有样式：**' + r.classes.coverage.usedWithStyle + '/' + r.classes.coverage.usedTotal + '**');
  P('- 有样式且被使用：**' + r.classes.coverage.definedCoveredByUsage + '/' + r.classes.coverage.definedTotal + '**');
  P('');
  P('### 使用但缺 CSS 样式的 class（' + r.classes.missingStyleForUsed.length + '）');
  if (!r.classes.missingStyleForUsed.length) P('无 ✅');
  else r.classes.missingStyleForUsed.forEach((m) => P('- `.' + m.name + '`' + (m.dynamicPrefix.length ? '（可能是动态拼接前缀：' + m.dynamicPrefix.map((d) => '.' + d).join(' ') + '）' : '')));
  P('');
  P('### 死 CSS class · 旧版 #grid 体系疑似遗留（' + r.classes.deadLegacy.length + '）');
  P(r.classes.deadLegacy.length ? r.classes.deadLegacy.map((c) => '`.' + c + '`').join('、') : '无');
  P('');
  P('### 死 CSS class · 其他未被静态引用（' + r.classes.deadOther.length + '）');
  P(r.classes.deadOther.length ? r.classes.deadOther.map((c) => '`.' + c + '`').join('、') : '无');
  P('');
  P('### 动态/参数类白名单（静态不可判定，不计死类）：' + (r.classes.whitelistUnreferenced.length ? r.classes.whitelistUnreferenced.map((c) => '`.' + c + '`').join('、') : '无'));
  P('');
  P('## c. 旧配色残留');
  P('');
  P('| 颜色 | 总计 | CSS | JS | HTML | 其中主题 token(@:root) | **残留(非 token)** |');
  P('| --- | --- | --- | --- | --- | --- | --- |');
  r.colors.oldPalette.forEach((p) => {
    P('| `' + p.normalized + '` | ' + p.total + ' | ' + p.css + ' | ' + p.js + ' | ' + p.html + ' | ' + p.themeToken + ' | **' + p.residue + '** |');
  });
  P('');
  P('旧配色合计：' + r.colors.oldPaletteTotal + ' 处，其中 :root 主题 token ' + r.colors.oldPaletteThemeTokenTotal + ' 处，**残留 ' + r.colors.oldPaletteResidueTotal + ' 处**。');
  P('');
  const residueHits = [];
  r.colors.oldPalette.forEach((p) => p.hits.forEach((h) => { if (!h.themeToken) residueHits.push({ color: p.normalized, line: h.line, region: h.region, text: h.lineText }); }));
  residueHits.sort((a, b) => b.line - a.line);
  if (residueHits.length) {
    P('残留位置（最多列 80 条）：');
    P('');
    for (const h of residueHits.slice(0, 80)) P('- L' + h.line + ' [' + h.region + '] `' + h.color + '` — ' + h.text);
    if (residueHits.length > 80) P('- …… 其余 ' + (residueHits.length - 80) + ' 条见 JSON');
  }
  P('');
  P('硬编码颜色总览：唯一 hex ' + r.colors.uniqueHexCount + ' 种；rgb()/rgba() ' + r.colors.rgbCount + ' 处；hsl()/hsla() ' + r.colors.hslCount + ' 处。Top 颜色见 JSON `colors.inventoryTop30`。');
  P('');
  P('主题 token（:root 变量）：' + (r.colors.themeTokens.length ? r.colors.themeTokens.map((t) => '`' + t.name + '`').join('、') : '无'));
  if (r.colors.unusedThemeVars.length) P('\n> 定义了但没被 var() 使用的 token：' + r.colors.unusedThemeVars.map((v) => '`' + v + '`').join('、'));
  P('');
  P('## d. 内联样式清单');
  P('');
  P('共 ' + r.inlineStyles.count + ' 处 `style="..."`：视觉类（新主题应接管/可移除）**' + r.inlineStyles.visualOverridable + '**，布局度量类（需保留）**' + r.inlineStyles.layoutDynamic + '**。');
  P('');
  if (r.inlineStyles.items.length) {
    P('| 行 | 区域 | 分类 | 内容 |');
    P('| --- | --- | --- | --- |');
    r.inlineStyles.items.forEach((it) => {
      P('| L' + it.line + ' | ' + it.region + ' | ' + it.classify.split('（')[0] + ' | `' + snippetOf(it.cssText, 110).replace(/\|/g, '\\|') + '` |');
    });
  }
  P('');
  if (r.inlineStyles.jsStyleAssignments.length) {
    P('JS 运行时写样式（`.style.xxx =`，需保留）：');
    r.inlineStyles.jsStyleAssignments.forEach((j) => P('- L' + j.line + ' `' + j.prop + '` = ' + j.value));
    P('');
  }
  P('## e. JS 注入布局变量 --sw / --sh');
  P('');
  P('| 项 | 次数 |');
  P('| --- | --- |');
  P('| CSS `var(--sw)` | ' + r.injectedVars.cssVarUsage + ' |');
  P('| CSS `var(--sh)` | ' + r.injectedVars.cssVarUsageSh + ' |');
  P('| JS `setProperty(--sw)` | ' + r.injectedVars.jsSetPropertySw + ' |');
  P('| JS `setProperty(--sh)` | ' + r.injectedVars.jsSetPropertySh + ' |');
  P('');
  P('结论：**' + (r.injectedVars.ok ? '保留 ✅（JS 注入 + CSS 消费都在）' : '缺失 ❌（单屏铺满布局会失效）') + '**');
  P('');
  return L.join('\n');
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error('[参数错误] ' + e.message); process.exitCode = 2; return; }
  if (opts.help) { console.log('用法: node static-check.js --label before|after [--html <file>] [--json]'); return; }
  if (!fs.existsSync(opts.html)) { console.error('[错误] 找不到文件: ' + opts.html); process.exitCode = 2; return; }

  const r = analyze(opts.html, opts.label);
  const jsonFile = path.join(VERIFY_DIR, 'static-check-' + opts.label + '.json');
  const mdFile = path.join(VERIFY_DIR, 'static-check-' + opts.label + '.md');
  fs.writeFileSync(jsonFile, JSON.stringify(r, null, 2));
  fs.writeFileSync(mdFile, toMarkdown(r));

  if (opts.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const c = r.classes;
  console.log('');
  console.log('================ 静态检查 ' + opts.label + ' ================');
  console.log('文件: ' + r.file.path + '  (' + r.file.bytes + 'B, ' + r.file.lines + ' 行)');
  console.log('sha256: ' + r.file.sha256);
  console.log('结构: style×' + r.file.styleBlocks + ' script×' + r.file.scriptBlocks +
    ' | CSS 花括号 ' + (r.structure.cssBraces.ok ? 'OK' : 'FAIL') +
    ' | appJS 花括号(启发式) ' + (r.structure.appJsBraces.balanced ? 'OK' : 'FAIL') +
    ' | CSS 规则 ' + r.structure.cssRules + ' | !important ' + r.structure.importantCount);
  console.log('class: 定义 ' + c.definedCount + '，使用 ' + c.usedCount + '（HTML ' + c.htmlUsedCount + '/JS ' + c.jsUsedCount + '）' +
    '，使用中已有样式 ' + c.coverage.usedWithStyle + '/' + c.coverage.usedTotal +
    '，缺样式 ' + c.missingStyleForUsed.length +
    '，死类(旧#grid) ' + c.deadLegacy.length + '，死类(其他) ' + c.deadOther.length);
  if (c.missingStyleForUsed.length) console.log('  ⚠ 缺样式 class: ' + c.missingStyleForUsed.map((m) => '.' + m.name).join(', '));
  console.log('旧配色: 总 ' + r.colors.oldPaletteTotal + ' 处，主题 token ' + r.colors.oldPaletteThemeTokenTotal + ' 处，**残留 ' + r.colors.oldPaletteResidueTotal + ' 处**');
  if (r.colors.oldPaletteResidueTotal) console.log('  残留分布: ' + r.colors.oldPalette.filter((p) => p.residue).map((p) => p.normalized + '×' + p.residue).join(', '));
  console.log('内联样式: ' + r.inlineStyles.count + ' 处（视觉可接管 ' + r.inlineStyles.visualOverridable + '，布局需保留 ' + r.inlineStyles.layoutDynamic + '）');
  console.log('--sw/--sh: ' + (r.injectedVars.ok ? '保留 ✅' : '缺失 ❌') + '（CSS var(--sw)=' + r.injectedVars.cssVarUsage + ', var(--sh)=' + r.injectedVars.cssVarUsageSh + '; JS setProperty sw=' + r.injectedVars.jsSetPropertySw + ', sh=' + r.injectedVars.jsSetPropertySh + '）');
  console.log('');
  console.log('报告: ' + path.relative(process.cwd(), mdFile));
  console.log('      ' + path.relative(process.cwd(), jsonFile));
}

main();
