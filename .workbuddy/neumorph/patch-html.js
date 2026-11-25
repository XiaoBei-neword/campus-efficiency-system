/* 对主 HTML 做 4 处精确替换（每处必须恰好命中 1 次，否则报错不写）。
   1) viewport 后插入 theme-color / color-scheme meta
   2) favicon 换新拟物粉彩配色
   3) #stLeftBar 去掉旧内联琥珀渐变（由 CSS .tile.t-wait .bar i 接管）
   4) 统计表百分比内联颜色 → .pct-val[.hi] class（由 CSS 接管） */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const target = path.join(root, '在校高效系统v0.2.1.html');
const html = fs.readFileSync(target, 'utf8');

const reps = [
  {
    name: 'meta-theme-color',
    from: '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    to: '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\r\n<meta name="theme-color" content="#E7ECF3">\r\n<meta name="color-scheme" content="light">'
  },
  {
    name: 'favicon-neumorphic',
    from: `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2312385a'/%3E%3Cpath d='M20 18h24a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V21a3 3 0 0 1 3-3z' fill='none' stroke='%238fd6ff' stroke-width='3'/%3E%3Cpath d='M25 33l6 6 11-13' fill='none' stroke='%2360e0a0' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">`,
    to: `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23E7ECF3'/%3E%3Crect x='7' y='7' width='50' height='50' rx='14' fill='%23EEF3F9'/%3E%3Cpath d='M22 19h20a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3V22a3 3 0 0 1 3-3z' fill='none' stroke='%236E9CC4' stroke-width='3'/%3E%3Cpath d='M26 33l6 6 11-13' fill='none' stroke='%237FBF9B' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">`
  },
  {
    name: 'stLeftBar-inline-gradient',
    from: '<div class="bar"><i id="stLeftBar" style="width:0%; background:linear-gradient(90deg,#f3cf95,#e0a13a)"></i></div>',
    to: '<div class="bar"><i id="stLeftBar" style="width:0%"></i></div>'
  },
  {
    name: 'stats-pct-inline-color',
    from: `'<span class="num" style="font-weight:600;color:' + (p >= 80 ? '#12813f' : '#4a6a86') + '">' + p + '%</span></td>' +`,
    to: `'<span class="num pct-val' + (p >= 80 ? ' hi' : '') + '">' + p + '%</span></td>' +`
  }
];

let out = html;
for (const r of reps) {
  const n = out.split(r.from).length - 1;
  if (n !== 1) throw new Error(`[${r.name}] 命中 ${n} 次（应为 1），已中止`);
  out = out.replace(r.from, r.to);
}
fs.writeFileSync(target, out, 'utf8');
console.log('patched:', target);
console.log('size:', Buffer.byteLength(out, 'utf8'), 'bytes');
for (const r of reps) console.log('  ✓', r.name);
