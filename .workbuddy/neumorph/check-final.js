/* 交付前静态自检（无需浏览器）。
   检查：文件完整性 / style-script 结构 / 所有 <script> 语法 / CSS 花括号配平 /
   新拟物关键 token 与选择器 / 旧配色残留 / 内联样式残留 / HTML 头 meta。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const target = path.join(root, '在校高效系统v0.2.1.html');
const html = fs.readFileSync(target, 'utf8');
let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.log('  ✗ ' + m); };

console.log('target:', target, '|', Buffer.byteLength(html, 'utf8'), 'bytes |', html.split(/\r?\n/).length, 'lines');

console.log('\n[1] 结构');
ok(`<style> × ${(html.match(/<style>/g) || []).length}`);
ok(`<script> × ${(html.match(/<script>/g) || []).length}`);
ok(`</style> × ${(html.match(/<\/style>/g) || []).length}, </script> × ${(html.match(/<\/script>/g) || []).length}`);
html.trimEnd().endsWith('</html>') ? ok('以 </html> 结尾') : bad('缺少 </html>');
const styleOpen = html.indexOf('<style>'), styleClose = html.indexOf('</style>'), headClose = html.indexOf('</head>');
(styleOpen > 0 && styleClose > styleOpen && styleClose < headClose) ? ok('style 块位于 head 内') : bad('style 块位置异常');

console.log('\n[2] script 语法（vm 编译，不执行）');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
scripts.forEach((code, i) => {
  try { new vm.Script(code, { filename: `block-${i + 1}.js` }); ok(`block ${i + 1} 语法 OK (${code.length} chars)`); }
  catch (e) { bad(`block ${i + 1} 语法错误: ${e.message}`); }
});

console.log('\n[3] CSS');
const css = html.slice(styleOpen + 7, styleClose);
const ob = (css.match(/\{/g) || []).length, cb = (css.match(/\}/g) || []).length;
ob === cb ? ok(`花括号配平 ${ob}/${cb}`) : bad(`花括号不配平 ${ob}/${cb}`);
const rules = (css.match(/\}/g) || []).length;
ok(`规则数约 ${rules}`);
[['--shadow-out:-5px -5px 15px', '基准外阴影 -5px -5px 15px'],
 ['5px 5px 15px', '基准外阴影 5px 5px 15px'],
 ['--shadow-in:', '内阴影 token'],
 ['--blue:#C8E0F4', '软蓝 #C8E0F4'],
 ['--pink:#F5E0E8', '软粉 #F5E0E8'],
 ['--bg:#E7ECF3', '软灰底 #E7ECF3'],
 ['var(--sw)', '消费 JS 注入 --sw'],
 ['var(--sh)', '消费 JS 注入 --sh'],
 ['.pct-val', '统计百分比类'],
 ['.tile.t-wait .bar i', '未交进度条新配色'],
 ['.subj-grid', '科目网格'],
 ['.scard.done', '卡片完成态'],
 ['.modal-mask', '弹窗遮罩'],
 ['.hist-tbl', '历史表格'],
 ['.toast', 'Toast'],
 ['.unsupported-card', '兜底页'],
 ['.subj-panels.prep-right', '面板切屏动画'],
 ['@media (prefers-reduced-motion:reduce)', '减少动效'],
].forEach(([needle, label]) => css.includes(needle) ? ok(label) : bad('缺少：' + label));

console.log('\n[4] 旧配色残留（应为 0）');
const oldColors = ['#12385a', '#1a5b8d', '#0c2740', '#14476f', '#c62828', '#16a34a', '#12813f', '#e0a13a', '#f3cf95', '#f1f5f9', '#fbfdff', '#9fc0da', '#8fd6ff', '#60e0a0', '#eaf7ee', '#eef3f9', '#e2e9f1'];
let oldHits = 0;
oldColors.forEach((c) => { const n = html.toLowerCase().split(c).length - 1; if (n) { oldHits += n; bad(`${c} × ${n}`); } });
if (!oldHits) ok('无 v0.2.1 旧配色残留');

console.log('\n[5] 3 处不可被纯 CSS 覆盖项');
html.includes('id="stLeftBar" style="width:0%"') ? ok('#stLeftBar 内联渐变已移除') : bad('#stLeftBar 内联样式未清理');
(html.includes("'<span class=\"num pct-val'") && !html.includes("color:' + (p >= 80")) ? ok('统计百分比改 class 化') : bad('统计百分比内联色未清理');
html.includes('<meta name="theme-color" content="#E7ECF3">') ? ok('theme-color meta') : bad('缺 theme-color');

console.log('\n[6] 内联 style 清单（应仅剩布局/宽度类）');
const inline = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
const visual = inline.filter((s) => /(?:^|;)\s*(?:color|background|border-color|box-shadow|font-family)\s*:/.test(s));
console.log('  inline style 共', inline.length, '处；含视觉属性', visual.length, '处');
visual.forEach((s) => console.log('    ·', s.slice(0, 100)));

console.log('\n[7] JS 契约选择器仍存在');
['.scard', 'data-sid', 'data-subject', 'subj-grid', 'sc-n', 'sc-s', 'sc-b', 'classList.toggle(\'active\'', 'hist-tbl', 'row-del', 'pct-val'].forEach((s) =>
  html.includes(s) ? ok(s) : bad('缺失契约：' + s));

console.log('\n' + (fail ? `FAIL ${fail} 项` : 'ALL STATIC CHECKS PASSED'));
process.exitCode = fail ? 1 : 0;
