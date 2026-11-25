'use strict';
/**
 * compare.js — 对比 before / after 两次基线，输出回归结论（纯静态，不需要浏览器）
 *
 * 用法：
 *   node compare.js                      # 读 .workbuddy/verify/before 与 after
 *   node compare.js --before before --after after --json
 *
 * 判定规则（任一命中即 FAIL）：
 *   - 断言由「通过」变「失败」（regressed）
 *   - after 缺失 before 中存在的场景截图，或截图尺寸不一致
 *   - after 的控制台 error 数多于 before
 *   - after/baseline.json 自身 ok=false（场景中断、源码运行中被改等）
 * 仅提示不判失败：
 *   - 新增/删除断言、计算样式变化（新拟物化改造的预期结果）、截图字节数变化（时钟秒数每次不同）
 */
const fs = require('node:fs');
const path = require('node:path');

const VERIFY_DIR = __dirname;

function parseArgs(argv) {
  const opts = { before: 'before', after: 'after', json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error('参数 ' + a + ' 缺少取值');
      return v;
    };
    if (a === '--before') opts.before = next();
    else if (a === '--after') opts.after = next();
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error('未知参数: ' + a);
  }
  return opts;
}

function loadBaseline(label) {
  const file = path.join(VERIFY_DIR, label, 'baseline.json');
  if (!fs.existsSync(file)) return { label, file, missing: true };
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { label, file, error: 'JSON 解析失败: ' + e.message }; }
  return { label, file, data };
}

function indexBy(list, key) {
  const m = new Map();
  for (const item of list || []) m.set(item[key], item);
  return m;
}

const STYLE_PROPS = ['background', 'backgroundImage', 'color', 'borderColor', 'borderRadius', 'boxShadow', 'fontFamily', 'padding', 'gap'];

function diffStyleSamples(before, after) {
  const out = { elements: [], changedElements: 0, changedProps: 0, comparedElements: 0 };
  if (!before || !after) return out;
  const keys = new Set(Object.keys(before).concat(Object.keys(after)));
  for (const k of keys) {
    const b = before[k] || {};
    const a = after[k] || {};
    if (!before[k] || !after[k]) continue;
    out.comparedElements++;
    const changes = {};
    for (const p of STYLE_PROPS) {
      if (String(b[p] || '') !== String(a[p] || '')) {
        changes[p] = { before: b[p], after: a[p] };
        out.changedProps++;
      }
    }
    if (Object.keys(changes).length) {
      out.changedElements++;
      out.elements.push({ element: k, changes });
    }
  }
  return out;
}

const OBS_KEYS = [
  ['empty', 'tiles'],
  ['main', 'columns'],
  ['main', 'totalCards'],
  ['main', 'names'],
  ['done', 'doneTotal'],
  ['done', 'donePerSubject'],
  ['stats', 'rowCount'],
  ['soc', 'columns'],
  ['soc', 'totalCards'],
  ['search', 'totalCards'],
  ['mobile', 'totalCards'],
];

function pickObs(observations, key1, key2) {
  const o = (observations || {})[key1];
  if (!o) return undefined;
  return o[key2];
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error('[参数错误] ' + e.message); process.exitCode = 2; return; }
  if (opts.help) {
    console.log('用法: node compare.js [--before before] [--after after] [--json]');
    return;
  }

  const B = loadBaseline(opts.before);
  const A = loadBaseline(opts.after);
  if (B.missing) { console.error('[缺少 before 基线] ' + B.file + '\n请先运行: node run.js --out before'); process.exitCode = 2; return; }
  if (A.missing) { console.error('[缺少 after 基线] ' + A.file + '\n请先运行: node run.js --out after'); process.exitCode = 2; return; }
  if (B.error || A.error) { console.error('[基线读取失败] ' + (B.error || A.error)); process.exitCode = 2; return; }

  const b = B.data, a = A.data;
  const problems = [];
  const notes = [];

  /* ---------- 截图 ---------- */
  const bs = indexBy(b.screenshots, 'id');
  const as = indexBy(a.screenshots, 'id');
  const shotIds = new Set([...bs.keys(), ...as.keys()]);
  const missingShots = [];
  const sizeDiffs = [];
  for (const id of [...bs.keys()].sort()) {
    if (!as.has(id)) { missingShots.push(id); continue; }
    const x = bs.get(id), y = as.get(id);
    if (x.width !== y.width || x.height !== y.height) sizeDiffs.push({ id, before: x.width + 'x' + x.height, after: y.width + 'x' + y.height });
  }
  const newShots = [...as.keys()].filter((id) => !bs.has(id)).sort();
  if (missingShots.length) problems.push('after 缺失截图: ' + missingShots.join(', '));
  if (sizeDiffs.length) problems.push('截图尺寸变化: ' + sizeDiffs.map((d) => d.id + '(' + d.before + '→' + d.after + ')').join(', '));

  /* ---------- 断言 ---------- */
  const ba = indexBy(b.assertions, 'name');
  const aa = indexBy(a.assertions, 'name');
  const regressed = [];
  const fixed = [];
  const stillFailing = [];
  const missingAssertions = [];
  const newAssertions = [];
  for (const [name, x] of ba) {
    if (!aa.has(name)) { missingAssertions.push(name); continue; }
    const y = aa.get(name);
    if (x.ok && !y.ok) regressed.push({ name, expected: x.expected, before: x.actual, after: y.actual });
    else if (!x.ok && y.ok) fixed.push(name);
    else if (!x.ok && !y.ok) stillFailing.push(name);
  }
  for (const name of aa.keys()) if (!ba.has(name)) newAssertions.push(name);
  if (regressed.length) problems.push('断言回归 ' + regressed.length + ' 条: ' + regressed.map((r) => r.name).join(', '));
  if (!a.ok) problems.push('after/baseline.json ok=false' + (a.runError ? '（' + String(a.runError).split('\n')[0] + '）' : ''));

  /* ---------- 控制台 ---------- */
  const bc = (b.console && b.console.counts) || {};
  const ac = (a.console && a.console.counts) || {};
  const afterErrors = (a.console && a.console.entries || []).filter((e) => e.level === 'error');
  if ((ac.errors || 0) > (bc.errors || 0)) problems.push('after 控制台 error 数增加: ' + (bc.errors || 0) + ' → ' + (ac.errors || 0));
  const beforeErrorTexts = new Set(((b.console && b.console.entries) || []).filter((e) => e.level === 'error').map((e) => e.text));
  const newErrorTexts = afterErrors.filter((e) => !beforeErrorTexts.has(e.text)).map((e) => e.text);

  /* ---------- 源码 / 版本 ---------- */
  const src = { before: b.source || {}, after: a.source || {} };
  if (src.before.sha256Before && src.after.sha256Before && src.before.sha256Before === src.after.sha256Before) {
    notes.push('⚠ before/after 被测 HTML 的 sha256 完全相同：改版可能未保存或未生效');
  }
  if (src.after.stableDuringRun === false) problems.push('after 运行期间主 HTML 被修改（baseline 记录 stableDuringRun=false）');

  /* ---------- 行为观测 ---------- */
  const obsDiffs = [];
  for (const [k1, k2] of OBS_KEYS) {
    const vb = pickObs(b.observations, k1, k2);
    const va = pickObs(a.observations, k1, k2);
    if (vb === undefined && va === undefined) continue;
    const sb = JSON.stringify(vb), sa = JSON.stringify(va);
    if (sb !== sa) obsDiffs.push({ path: k1 + '.' + k2, before: vb, after: va });
  }

  /* ---------- 风格变化 ---------- */
  const styleMain = diffStyleSamples(pickObs(b.observations, 'styleDesktopMain', undefined) || b.observations && b.observations.styleDesktopMain,
    pickObs(a.observations, 'styleDesktopMain', undefined) || a.observations && a.observations.styleDesktopMain);
  const styleDone = diffStyleSamples(b.observations && b.observations.styleDesktopDone, a.observations && a.observations.styleDesktopDone);
  if (styleMain.comparedElements && styleMain.changedElements === 0 && styleDone.changedElements === 0) {
    notes.push('⚠ 关键元素计算样式在 before/after 之间完全没变：新拟物化主题可能没生效');
  }

  const result = {
    ok: problems.length === 0,
    problems,
    notes,
    screenshots: {
      before: bs.size, after: as.size, missingInAfter: missingShots, newInAfter: newShots,
      sizeDiffs: sizeDiffs,
      changedBytes: [...bs.keys()].filter((id) => as.has(id) && bs.get(id).bytes !== as.get(id).bytes).length,
    },
    assertions: {
      before: ba.size, after: aa.size,
      regressed, fixed, stillFailing, missingInAfter: missingAssertions, newInAfter: newAssertions,
    },
    console: {
      before: bc, after: ac,
      newErrorTexts: newErrorTexts.slice(0, 20),
      afterErrorEntries: afterErrors.slice(0, 20),
    },
    behaviorDiffs: obsDiffs,
    style: {
      main: { compared: styleMain.comparedElements, changedElements: styleMain.changedElements, changedProps: styleMain.changedProps, elements: styleMain.elements },
      done: { compared: styleDone.comparedElements, changedElements: styleDone.changedElements, changedProps: styleDone.changedProps, elements: styleDone.elements },
    },
    knownIssues: { before: b.knownIssues || [], after: a.knownIssues || [] },
    files: { before: B.file, after: A.file },
    html: {
      before: src.before.sha256Before, after: src.after.sha256Before,
      bytesBefore: src.before.bytes, bytesAfter: src.after.bytes,
      stableDuringRun: src.after.stableDuringRun,
    },
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  /* ---------- 人类可读输出 ---------- */
  console.log('');
  console.log('==================== before → after 对比 ====================');
  console.log('before: ' + B.file + '  (' + (b.generatedAt || '?') + ')');
  console.log('after : ' + A.file + '  (' + (a.generatedAt || '?') + ')');
  console.log('HTML  : before=' + String(src.before.sha256Before || '').slice(0, 12) + ' / after=' + String(src.after.sha256Before || '').slice(0, 12) +
    '（' + (src.before.bytes || '?') + 'B → ' + (src.after.bytes || '?') + 'B）');
  console.log('');
  console.log('--- 截图（' + bs.size + ' → ' + as.size + '）---');
  for (const id of [...bs.keys()].sort()) {
    const x = bs.get(id), y = as.get(id);
    if (!y) { console.log('  ✗ ' + id + '  缺失（before ' + x.width + 'x' + x.height + '）'); continue; }
    console.log('  ✓ ' + id + '  ' + x.width + 'x' + x.height + ' → ' + y.width + 'x' + y.height + '  ' + Math.round(x.bytes / 1024) + '→' + Math.round(y.bytes / 1024) + 'KB');
  }
  for (const id of newShots) console.log('  + ' + id + '（after 新增）');
  console.log('');
  console.log('--- 断言（' + ba.size + ' → ' + aa.size + '）---');
  console.log('  回归: ' + regressed.length + '；修复: ' + fixed.length + '；仍然失败: ' + stillFailing.length + '；after 缺失: ' + missingAssertions.length + '；after 新增: ' + newAssertions.length);
  regressed.forEach((r) => console.log('  ✗ ' + r.name + '  before=' + JSON.stringify(r.before) + ' → after=' + JSON.stringify(r.after)));
  stillFailing.forEach((n) => console.log('  ! ' + n + '（before/after 都失败，已知基线问题）'));
  if (missingAssertions.length) console.log('  ? after 缺失断言: ' + missingAssertions.join(', '));
  console.log('');
  console.log('--- 行为观测差异 ---');
  if (!obsDiffs.length) console.log('  无');
  else obsDiffs.forEach((d) => console.log('  ' + d.path + ': ' + JSON.stringify(d.before) + ' → ' + JSON.stringify(d.after)));
  console.log('');
  console.log('--- 风格变化（新拟物化是否生效）---');
  console.log('  主界面: 对比 ' + styleMain.comparedElements + ' 个元素，' + styleMain.changedElements + ' 个变化，共 ' + styleMain.changedProps + ' 项属性');
  console.log('  完成态: 对比 ' + styleDone.comparedElements + ' 个元素，' + styleDone.changedElements + ' 个变化，共 ' + styleDone.changedProps + ' 项属性');
  for (const el of styleMain.elements.slice(0, 12)) {
    console.log('   · ' + el.element + ': ' + Object.keys(el.changes).join(', '));
  }
  console.log('');
  console.log('--- 控制台 ---');
  console.log('  before: errors=' + (bc.errors || 0) + ', warnings=' + (bc.warnings || 0) + '；after: errors=' + (ac.errors || 0) + ', warnings=' + (ac.warnings || 0));
  if (newErrorTexts.length) {
    console.log('  after 新增错误:');
    newErrorTexts.slice(0, 10).forEach((t) => console.log('   ✗ ' + String(t).slice(0, 200)));
  }
  console.log('');
  console.log('--- 已知问题 ---');
  const known = (a.knownIssues || []);
  if (!known.length) console.log('  after 无已知问题');
  else known.forEach((k) => console.log('  ' + k.id + ': ' + k.text));
  if (notes.length) { console.log(''); console.log('--- 提示 ---'); notes.forEach((n) => console.log('  ' + n)); }
  if (problems.length) {
    console.log('');
    console.log('--- 需要处理 ---');
    problems.forEach((p) => console.log('  ✗ ' + p));
  }
  console.log('');
  console.log('VERDICT: ' + (result.ok ? 'PASS（无回归）' : 'FAIL（' + problems.length + ' 项问题）'));
  process.exitCode = result.ok ? 0 : 1;
}

main();
