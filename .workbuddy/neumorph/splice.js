/* 把 .workbuddy/neumorph/theme.css 整体替换进单文件 <style> 块。
   用法: node splice.js [目标 html]
   安全: 动态定位唯一的 <style>…</style>（支持重复执行）、校验花括号配平、写前备份 .bak。 */
'use strict';
const fs = require('fs');
const path = require('path');

const here = __dirname;
const root = path.resolve(here, '..', '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, '在校高效系统v0.2.1.html');
const cssFile = path.join(here, 'theme.css');

const html = fs.readFileSync(target, 'utf8');
const eol = html.includes('\r\n') ? '\r\n' : '\n';
const lines = html.split(/\r?\n/);

const openIdx = lines.findIndex((l) => l.trim() === '<style>');
const closeIdx = lines.findIndex((l) => l.trim() === '</style>');
if (openIdx < 0 || closeIdx < 0 || closeIdx <= openIdx) throw new Error(`style 块定位失败 open=${openIdx} close=${closeIdx}`);
if (lines.filter((l) => l.trim() === '<style>').length !== 1) throw new Error('存在多个 <style> 块');
if (lines.filter((l) => l.trim() === '</style>').length !== 1) throw new Error('存在多个 </style> 块');

let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');
let bal = 0, ln = 1;
for (const ch of css) {
  if (ch === '\n') ln++;
  if (ch === '{') bal++;
  else if (ch === '}') { bal--; if (bal < 0) throw new Error('花括号下溢 @css line ' + ln); }
}
if (bal !== 0) throw new Error('花括号不配平: ' + bal);
const cssLines = css.split('\n');
while (cssLines.length && cssLines[cssLines.length - 1] === '') cssLines.pop();

const out = [...lines.slice(0, openIdx), '<style>', ...cssLines, '</style>', ...lines.slice(closeIdx + 1)];
const text = out.join(eol);

fs.writeFileSync(target + '.bak', html, 'utf8');
fs.writeFileSync(target, text, 'utf8');

const s = out.findIndex((l) => l.trim() === '<style>') + 1;
const e = out.lastIndexOf('</style>') + 1;
console.log('target :', target);
console.log('written:', Buffer.byteLength(text, 'utf8'), 'bytes /', out.length, 'lines  (eol=' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');
console.log('<style> line', s, ' </style> line', e, ' css lines', cssLines.length);
console.log('backup :', target + '.bak');
