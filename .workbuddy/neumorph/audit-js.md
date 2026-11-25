# JS 侧 UI / 内联样式 / 布局度量审计（新拟物化 Neumorphism）

- 目标：`在校高效系统v0.2.1.html`（2378 行 / 988,316 B / UTF-8 无 BOM；`<script>` 3 块 = L740 / L775 / L799）
- 方式：read 全文逐段 + grep 全量核对行号；只读审计，未改主 HTML。报告行号均对应当前文件。
- 结论：**UI 约 95% 可由 CSS 完成**；仅 **3 处**无法被纯 CSS 自然覆盖（标 ⚠）：L646 未交条内联底色、L1291 统计百分比 JS 内联色、L1204–1205 grid 内联布局属性（可 `!important` 硬覆盖）；另有 5 类 JS DOM/class 契约必须保留（§5、§7）。

## 0. 与任务描述不一致的事实（行号漂移，已核对）
- CSS 实际为 **L8–L601**（`<style>` L8、`</style>` L602），L1–L7 是 head；并非 L1–602。
- 静态 HTML 不止 L604–739：**L759–L771**（`#modalMask` 弹窗骨架、`#toasts`、`#fileInput`）也是静态 HTML，位于兼容脚本之后。
- 兼容兜底脚本 L740–L757 ✓；内联 SheetJS L775–L798 ✓（L776 注释，L777–797 是 21 行约 30KB 的压缩代码，跳过）。
- 应用脚本 L799–L2376 ✓（IIFE L800–2375，实际 1578 行）。**不存在“1688 行超长行”**：L1687/1688 是 `STYLES_XML` 普通两行（78/86 字符）；全文件 >300 字符的行只有 **L7**（favicon data-URI，443 字符）与 **L777–797**（SheetJS，每行约 30KB），应用脚本内没有超长行。
- 任务提到的 126/150/106/146/72/100 阈值与 `no-rate/no-time/no-state` 属 **v0.2.0 遗留**：JS 已不产生这些 class（仅 CSS L518–523 残留），当前 JS 只产生 `.subj-grid.tiny`（L1208）；实际常量见 §3.3。
- 卡片当前实际显示 **序号 + 状态（已完成/未完成）**；姓名只在 `title`/`aria-label`（L1118–1119）。导入弹窗文案 L2174 仍写“按序号+姓名展示”，已过期；若新设计要显示姓名，必须改 JS `cardHTML()`（见 §8-5）。
- 死代码/死变量：`firstSid()` L981、`fmtHM()` L816 定义后无调用；`--cw/--ch` 只在死 CSS（L498–514）中被引用，全文件没有任何 JS/CSS 赋值。

## 1. JS 动态生成的 DOM 模板（CSS 必须覆盖这些 class）
| 函数 | 行号 | 生成的 DOM / class（均为 innerHTML/createElement，无 shadow DOM） |
|---|---|---|
| `toast()` | 830–842 | `.toast[.good|.bad]` > `.ti` + `<span>`；进函数先清空 `#toasts`（832），2.4s 后加 `.out`（839） |
| `renderStats()` | 1076–1095 | 改 `#stTotal/#stDone/#stLeft` 文本、`#stRate` innerHTML（`<small>%</small>`）、3 条 `.bar > i` 宽度 |
| `renderPanels()` | 1126–1154 | 每组：`.subj-panels[data-group][.active]` → `section.subj` → `.subj-head`（`.subj-name`、`.subj-cnt[data-cnt]`）+ `.subj-grid[data-subject]` → 42×`.scard` 或 `.blank` |
| `cardHTML()` | 1113–1124 | `.scard[data-sid][data-subject][role=button][tabindex=0][aria-pressed][title][aria-label][.done]` → `.sc-n`（序号）+ `.sc-s`（已完成/未完成）+ 可选 `.sc-b.sbN`（名次 1–5） |
| `syncPanel()` | 1215–1246 | 就地切 `.scard.done`、改 `.sc-s` 文本、建/改 `.sc-b.sbN` 并加 `.pop`、删徽章；`updateCounts()` 1156–1164 改 `.subj-cnt` |
| `renderTabs/renderSwitch()` | 1097–1111 | `.tab.active` / `.ssw.active` + `aria-selected` |
| `renderAll()` | 1328–1343 | `#panels/#empty/#statsView` 的 `hidden`；`#btnExport.disabled` |
| `renderStatsView()` | 1248–1326 | `.view-pad` > `.sect-title` + `.day-list` > `.day-card`（`.d`、`.n`、`.bar > i`）；`.tbl`（`th`、`td.num.ok|.dim`、`td.sidc`、`.mini-bar[.hi] > i`、内联色 `.num`、`button.row-del[data-del]`） |
| `modal.open()` | 1426–1454 | `#modalTitle` 文本 / `#modalDesc` innerHTML / `#modalBody` / `#modalFoot` > `button.btn[.btn-primary|.btn-danger]`；`.modal.wide`；`#modalMask.hidden` |
| `openAddStudent()` | 1468–1499 | `.field`×2 > `label(+em)` + `input[type=text]#inSid/#inName` + `.err` |
| `openDeleteStudent()` | 1502–1520 | `.kv > span/span`（第二 span 内联 `font-family:inherit`） |
| `openReset()` | 1523–1580 | `label.opt[.on]#optA/#optB` > `input[radio]` + `span.opt-body` > `span.t` + `span.d`；整行点击同步 `.on` |
| `previewImport()` | 2151–2192 | `.chips` > `.chip`（>24 人时 `.chip.more`）、`.kv` 行、`.notice`（内嵌 SVG，`stroke="currentColor"`） |
| `openHistory()` | 2195–2255 | `.hist-dates` > `button.hd[.on][data-d]`、`.hist-sum`、`.hist-wrap` > `.hist-tbl`（`.hk`/`.hm`）、`.hist-empty` |
| `download()` | 1823–1835 | 临时 `<a style="display:none">` |
| `setGroup()` | 1345–1368 | 给 `.subj-panels` 加 `prep-left/right` → `leaving-left/right` + `active`（430ms 后清理 leaving） |

## 2. 内联样式与硬编码颜色（逐条）
### 2.1 静态 HTML 内联 style（3 处 + 图标）
- L641 `#stDoneBar style="width:0%"`、L651 `#stRateBar style="width:0%"`（运行时由 JS 改宽度）
- L646 `#stLeftBar style="width:0%; background:linear-gradient(90deg,#f3cf95,#e0a13a)"` ⚠ **内联色，CSS 覆盖不了**；改新配色须改这一行（或 `!important`/改 JS）
- L7 favicon data-URI 硬编码 `#12385a/#8fd6ff/#60e0a0`（可选改）
- L610–614、675、679、683、687、691、695、705–708、714 图标全部 `fill="none" stroke="currentColor"` → 颜色继承 `color`，可安全换色

### 2.2 JS 写入的 `.style.*`（grep 全量；**没有任何 cssText**）
| 行号 | 写法 | 值/语义 |
|---|---|---|
| 1085–1087 | `#stDoneBar/#stLeftBar/#stRateBar.style.width` | `pct(rate)+'%'`、`left/total*100+'%'` 或 `'0%'`（0–100） |
| 1168 | `grid.style.gridTemplateColumns/Rows = ''` | **空字符串重置**（n=0 时） |
| 1202–1203 | `gridTemplateColumns/Rows` | `repeat(c, X.Xpx)` / `repeat(r, X.Xpx)`（固定 px，非 minmax） |
| 1204 | `grid.style.overflow` | `'auto'`（降级滚动）/`'hidden'` ⚠ **覆盖 CSS，纯 CSS 改不动** |
| 1205 | `grid.style.alignContent` | `'start'`/`'center'` ⚠ 同上 |
| 1206–1207 | `setProperty('--sw'/'--sh', 'X.Xpx')` | 卡片宽/高 token；CSS L387/L403/L406 消费 |
| 1444 / 1452 | `document.body.style.overflow` | `'hidden'` 开弹窗 / `''` 关闭 |
| 1828 | `a.style.display='none'` | 下载锚点 |
| 1240 / 1356 | `void offsetWidth` | 强制 reflow（徽章 pop、面板动画），非样式 |
### 2.3 模板内联 style（JS 字符串，纯 CSS 难覆盖）
- L1290 `.mini-bar > i style="width:P%"`（P=完成率 0–100）；L1307 `.day-card .bar > i style="width:P%"`
- L1291 `.num` **内联色** `color:#12813f`（P≥80）/ `#4a6a86`（P<80）⚠ 纯 CSS 覆盖不了（需 `!important`）
- L1275/L1277 `th style="width:64px"`；L1287 `td.sidc style="text-align:center"`
- L1321 `div style="overflow:auto; margin-top:10px"`（统计表包裹层）
- L1507 `span style="font-family:inherit"`；L2230 `th style="text-align:center;width:70px"`；L2241–2242 `td` 的 text-align；L2265 `.notice style="margin-top:4px"`；L2173 SVG `style="flex:none;margin-top:1px"`
- 其余：**无 cssText、无 canvas、无动态 SVG 颜色**（JS SVG 仅 L2173，用 currentColor）
### 2.4 CSS 变量 / accent-color（决定改法）
- `:root` tokens L9–24（`--navy/--navy-2/--bg/--surface/--line/--text/--muted/--ok/--ok-soft/--danger/--radius/--shadow-sm/--shadow-md/--mono`）
- 覆盖率：`--danger` L19 **从未被引用**（危险色全是字面量）；`--ok` 仅 L88；`--ok-soft` 仅死类 `.pill.yes` L256；`--shadow-sm` 仅死 `.card` L162；`--radius` 仅 `.tile` L84；`--navy` 13 处；`--muted` 11 处；`--line` 18 处。
- `.opt input{accent-color:#12385a}` L300（单选钮，须随主色改）
- JS 只写 `--sw/--sh`；`--cw/--ch` 无任何赋值（死 CSS L498–514）→ 新 CSS **务必用 --sw/--sh**。

## 3. 布局度量（layoutOne，每个科目面板独立自适应）——padding/font/border 的边界
### 3.1 单屏不滚动的尺寸链（CSS；任何一环断掉 → clientHeight 归零 → 布局失效）
`html,body{height:100%}` L454 → `body{flex column;overflow:hidden}` L455 → `.topbar{flex:none}` L457（inner padding L458、logo/时钟字号 L459–463）→ `main.wrap{flex:1;min-height:0;flex column;max-width:1780;padding:0 20px 12px}` L465–468 → `.stats{flex:none}` L470 → `.board{flex:1;min-height:0;flex column}` L480 → `.board-head{flex:none}` L481 → `#panels{flex:1;min-height:0;overflow:hidden}` L362 → `.subj-panels{position:absolute;inset:0;padding:8px;gap:8px}` L363–364 → `.subj{flex column;min-width:0;overflow:hidden}` L374–375 → `.subj-head{flex:none}` L376 → `.subj-grid{flex:1;min-height:0;padding:8px;gap:6px}` L380–381。
- 不可改：`.board/#panels/.subj-grid` 的 `flex:1;min-height:0`、body flex/overflow、`[hidden]{display:none!important}` L26（JS 隐藏全靠它）。
- 可改（JS 每轮自动重测）：各类 padding、topbar/stats/board-head/subj-head 高度——但会挤压 H（见 §3.4）。
- 另有 L477–478 把 `.tile .sub`、`.meta-line`、`.foot` 设为 `display:none`（当前不可见；JS 仍会写 `#stTotalSub`），新拟物化不必重点处理这三块。
### 3.2 测量与算法（L1166–1209）
- n=L1167；`W = clientWidth - paddingL - paddingR` L1170；`H = clientHeight - paddingT - paddingB` L1171；`gap = columnGap || 6` L1172；`W<30||H<26` 直接 return（不写模板，沿用旧内联尺寸）L1173。
- 枚举 c=1..n、r=ceil(n/c)，`w=(W-gap(c-1))/c`、`h=(H-gap(r-1))/r` L1178–1180；`ar=w/h`，`pen=1-0.22*|ln(ar/1.7)|`（下限 .55）L1183–1184；`score=w*h*pen*(n/(c*r))` L1185。
- 候选过滤 `w≥44 && h≥26` L1187；全不满足时降级滚动：`useC=floor((W+gap)/(70+gap))`、`useH=max(30,min(useW*0.55,64))` L1191–1196。
- 定尺寸：`cw=min(useW,260)` L1199、`ch=min(useH,150)` L1200、0.1px 取整 L1201；写死 `repeat(c,cwpx)/repeat(r,chpx)` L1202–1203；写 `--sw/--sh` L1206–1207；`tiny = ch<40 || cw<56` L1208。
- 只测 `clientWidth/clientHeight` + computed padding + columnGap；**不用** getBoundingClientRect/offsetHeight；仅 L1240/1356 用 offsetWidth 强制 reflow。
- 重排时机：renderPanels L1153、setGroup L1367、切 tab L2334、resize（防抖 100ms）L2338–2342、orientationchange L2343–2345；**无 ResizeObserver**。
### 3.3 硬阈值一览
| 值 | 位置 | 含义 |
|---|---|---|
| 6 | L1172 + CSS L381 | grid gap（行/列共用同一值） |
| 30 / 26 | L1173 | 小于则放弃布局 |
| 1.7 / 0.22 / 0.55 | L1183–1184 | 目标宽高比 / 惩罚权重 / 下限 |
| 44 / 26 | L1187 | 候选卡片最小宽/高 |
| 70 / 0.55 / 64 / 30 | L1192–1194 | 降级最小宽 / 高度公式 / 高度上限 / 下限 |
| 260 / 150 | L1199–1200 | 卡片宽/高上限（大屏不放大） |
| 40 / 56 | L1208 | `tiny`：隐藏 `.sc-s`、缩小 `.sc-b`（CSS L418–419） |
| 8 / 6 | CSS L380–381 | `.subj-grid` padding / gap |
| 8 / 8 | CSS L364 | `.subj-panels` padding / gap |
### 3.4 风险结论（必须转告 Lead）
1. **ch 已贴近 tiny 阈值**：1366×768 估算 grid H≈520 → 最优 c=4 / rows=11 → **ch≈41.8px**，距 40 仅约 2px。`.subj-grid` gap 6→10 会直接把 ch 压到 ≈38 → `tiny` 生效；padding 8→16 后只剩 ≈40.4，再叠加 topbar/stats 任意纵向加高同样触发 → 卡片「已完成/未完成」文字整列消失。1080p 下 ch≈70，安全。
2. 垂直空间是刚性预算：topbar/stats/board-head/subj-head 每加 1px，grid H 少 1px。新拟物化优先用 `box-shadow`（不占布局）表达厚度，避免靠加 padding/border。
3. **阴影会被裁**：`.scard{overflow:hidden}` L386 + `.subj{overflow:hidden}` L375 + `.board{overflow:hidden}` L112 + `#panels{overflow:hidden}` L362 + JS 内联 `overflow:hidden` L1204；卡片间距仅 6px，外阴影还会互相压盖。要外阴影只能加大 padding/gap（触发风险 1）或改 JS L1204。
4. `gap` 必须单值：L1179–1180 用同一个 `gap` 算宽和高；写成 `gap:4px 10px` 会算错行高 → 卡片被裁。
5. 全局 `box-sizing:border-box` L25；不要把 `.scard/.subj-grid` 改 content-box，否则 L1170 的 padding 减法与实际内容盒不符。
6. 卡片尺寸/列数不能靠 CSS 改：JS 把固定 px 写进 grid-template（L1202–1203）；只能改 JS 常量（L1199/1200/1208）或 `tiny` 阈值。

## 4. 颜色语义映射（→ 新拟物化调色板）
| 语义 | 现有实现与位置 |
|---|---|
| 成功 / 已交（绿） | JS 内联 `#12813f` L1291；toast.good L341；`.scard.done` 渐变 `#43c67c/#20b061/#0f9146` + 边 `#0d8a42` + 阴影 L394–399；`.scard.done` 内文字/徽章 L400–407；`.tile.t-ok::before` var(--ok) L88、`.v` `#12813f` L98；`.bar`/`.mini-bar` 蓝渐变 L101/L253、`.mini-bar.hi` 绿 L254；`.tbl td.ok` L424；`.hist-tbl .hk` L443（`.pill.yes` L256 死） |
| 未交 / 等待（琥珀） | `#stLeftBar` 内联渐变 `#f3cf95→#e0a13a` L646；`.tile.t-wait::before` `#e0a13a` L89、`.v` `#b3761b` L99；`.sc-s` 默认灰 `#93a5b6` L406（文案“未完成”） |
| 主色 / 强调（深蓝） | `--navy #12385a` L10、`--navy-2 #1a5b8d` L11；topbar 渐变 `#0c2740→#14476f→#1a5b8d` L42；`.btn-primary` L145；`.tab.active` L125、`.ssw.active` L360、`.hd.on` L433；`accent-color` L300；`.sc-n` `#15334c` L404；focus 蓝 `#79b0dd/#3f8fce` L135/291/304/393 |
| 危险 / 重置（红） | `--danger #c62828` L19（未被引用）；`.btn-danger` L147–148、`.btn-ghost-danger` L149–150、JS 动态 `btn-danger` L1436；`.field .err` L292；`.toast.bad` L342/346；`.row-del` `#b3261e` L421–423；`.unsupported .badge` L555（`.del:hover` L195 死） |
| 中性 / 禁用 / 未完成 | `--line #e2e9f1` L14、`--muted #6c8199` L16、`#93a5b6/#8b9daf/#b6c4d2/#9aacbc/#a3b4c4`；`.btn:disabled` opacity .45 L151；`.hm` L444、`.dim` L425；`.blank`/`.hist-empty` L241/L445（`.pill.no` L257 死） |
| 名次徽章 | `.sc-b` 基础金渐变 L408–410（=1st，无 sb1 规则）；`.sb2` 银 L412、`.sb3` 铜 L414、`.sb4` 蓝 L416、`.sb5` 灰 L417；`.pop` 动画 L411（旧 `.r1–r5` L208–212 死） |
| 提示 / 遮罩 | `.notice` 琥珀 L318–320、`.notice.info` 蓝 L321（JS 从不加 info）；toast 白底 L334–340；modal 遮罩 `rgba(10,28,45,.46)`+blur L270 |

## 5. 动态 class / 属性触发条件
- `.scard.done`：初始 `cardHTML` L1116（isDone）；点击后 `syncPanel` L1222 就地切换；同步 `aria-pressed` L1117/1223
- `.sc-b.sb1..sb5` + `.pop`：`syncPanel` L1230–1240（名次 1–5；唯独刚点击者加 pop；下次名次变化时 className 重写会清掉 pop）
- `.subj-grid.tiny`：L1208（ch<40 || cw<56）→ CSS L418–419 隐藏 `.sc-s`、缩小 `.sc-b`
- `.tab.active` / `.ssw.active`：L1100 / L1108（+aria-selected）
- `.subj-panels.active|prep-left|prep-right|leaving-left|leaving-right`：初始 L1134；切换 L1354–1365（430ms 后移除 leaving）
- `.opt.on`：重置弹窗初始 L1530/1535 + 单选 change L1567–1568；`.opt` 整行点击 L1573–1579
- `.hd.on`：完成记录切日期 L2212；`.toast.good|.bad|.out`：L834/839；`#toasts` 同时只留一条（L832；第 6 名起清空 L1389）
- `.modal.wide`：完成记录 L1442（CSS L428）；`.empty.drag`：拖拽悬停 L2350/2355
- `hidden`：#panels/#empty/#statsView L1334–1336，#modalDesc L1430，#modalMask L1443/1451；`disabled`：#btnExport L1342（#btnImport 恒可点 L1340）
- `aria-pressed/aria-selected/data-sid/data-subject/data-group/data-cnt/data-del/data-view/data-d/title/role/tabindex`：见 §7.4
- **JS 不再产生**（勿按其设计）：`just`、`no-rate`、`no-time`、`no-state`、`anim`、`card.*`、`rate-track`、`rank/r1–r5`

## 6. 非 UI 但同源颜色（XLSX 导出，可选改）
- `STYLES_XML` L1687–1721：字体色 FF1F2D3A / FFFFFFFF / FF14385B / FF7A8B9B / FF166E3A / FF8A99A8；填充 FF14385B（表头）/ FFEAF7EE（完成行）；边框 FFD8E2EC；字体“等线”；L1720 TableStyleMedium2。
- `reportSheet()` L1838–1864 样式号：1=表头、2=左侧列、3=普通、4=标题、5=副标题、6=已完成、7=未完成/—（L1842–1852；文本“已完成/未完成”在 L1898）。
- favicon L7（#12385a/#8fd6ff/#60e0a0）。
- 均不影响页面渲染，**不改也完全不影响 UI**；仅品牌统一时再动。

## 7. 给 Lead 的 CSS 类名总清单（全文件去重）
统计：live class 共 **111** 个 = 静态独有 43 + 静态/JS 共用 4（`active, bar, btn, btn-primary`）+ 仅 JS 生成 64。
### 7.1 静态 HTML（L604–739、759–771）已出现（43）
`acts badge board board-head brand btn-ghost-danger clock clock-date clock-time empty foot hint ico k live logo meta-line modal modal-body modal-foot modal-head modal-mask search sep ssw stats sub subj-switch tab tabs tile tip toasts t-ok tools topbar topbar-inner t-rate t-wait unsupported unsupported-card v wrap`
### 7.2 只在 JS 生成、静态 HTML 完全没有（64）——**新 CSS 必须覆盖，否则这些 UI 无样式**
`bad blank btn-danger chip chips d day-card day-list dim done drag err field good hd hi hist-dates hist-empty hist-sum hist-tbl hist-wrap hk hm kv leaving-left leaving-right mini-bar more n notice num ok on opt opt-body out pop prep-left prep-right row-del sb1 sb2 sb3 sb4 sb5 sc-b sc-n sc-s scard sect-title sidc subj subj-cnt subj-grid subj-head subj-name subj-panels t tbl ti tiny toast view-pad wide`
- `sb1` 无字面量，由 `'sc-b sb'+rk` 拼接（L1122/1237）；`sb2–sb5` 定义在 L412–417，`sb1` 走 `.sc-b` 基础样式。
### 7.3 CSS 有定义但当前 DOM 永不出现（31，v0.2.0 遗留，不必花时间）
`anim card card-head card-mid del dot full grid info just lbl nm no no-rate no-state no-time pill r1 r2 r3 r4 r5 rank rate rate-track rate-val seq sid state st-time yes`
（对应 `#grid` L488–523、`.card*` L159–219、`.seq/.sid/.nm` L502–514、`.rank/.r*` L202–212、`.rate*` L213–219）
- **新旧对照**：`.grid→#panels/.subj-panels`、`.card→.scard`、`.sid/.seq→.sc-n`、`.state→.sc-s`、`.rank/.r1–r5→.sc-b/.sb1–sb5`、`.rate-track→.mini-bar`、`.del→.row-del`。
### 7.4 JS 依赖的 ID / 选择器（改名/删结构会报错或静默失效）
- 选择器：`.tab` `.ssw` `.scard` `.subj-grid` `.subj-panels` `.sc-s` `.sc-b` `.opt` `.modal` `.hd` `.subj-grid[data-subject]` `.scard[data-sid]` `.subj-panels[data-group]` `.subj-panels.active` `[data-cnt]` `[data-del]` `[data-d]`
- ID：`clockTime clockDate stTotal stDone stLeft stRate stDoneBar stLeftBar stRateBar stTotalSub panels empty statsView toasts modalMask modalTitle modalDesc modalBody modalFoot histDates histSum histBody inSid inName errSid optA optB search btnImport btnPick btnAdd btnExport btnHistory btnReset btnTpl fileInput app unsupported`
- 特殊依赖：`#modalFoot.lastChild.click()` L1496（Enter 提交新增学生，footer 末尾必须仍是确认按钮）；`input[name=rs]` L1531/1536；`.modal` 在 `#modalMask` 内 L1441；`body.style.overflow` L1444/1452。
- 对照 `.workbuddy/neumorph/theme.css`（21:49 版）：live 111 类中仅 `sb1`（拼接生成，走 `.sc-b` 基础）与 `sep`（`.meta-line` 分隔符，当前 L478 display:none）未见选择器，均非必需。

## 8. 最关键的 5 条（优先级排序）
1. 阴影/溢出：JS 内联 `overflow:hidden` L1204 + 6px grid gap + 多层 `overflow:hidden`（L362/L375/L386/L112），新拟物外阴影会被裁/互相压盖 → 先定方案：“加大内边距/gap” 还是 “改 JS L1204”。
2. 高度预算：1366×768 下 ch≈41.8px、tiny 阈值 40 → topbar/tile/board-head/subj-head/grid padding 任何纵向加高都可能让「已完成/未完成」整列消失。
3. 调色板残留：`:root` 改完仍有一批字面量（§4）；3 处无法自然被纯 CSS 覆盖：L646 未交条渐变、L1291 统计百分比色（需 `!important` 或改 HTML/JS）、L1204–1205 grid 内联布局属性；`accent-color` L300 在 CSS 里可直接改。
4. class 契约：§7.2 的 64 个 JS-only class + §7.4 的 ID/选择器必须保留；不要把 live 的 `.sc-n/.sc-s/.sc-b` 与死的 `.sid/.state/.rank` 混淆，也不要把 `.row-del` 当死的 `.del`。
5. 卡片没有姓名元素：`cardHTML` L1120–1121 只输出序号+状态，导入弹窗文案 L2174 已过期；要在卡片显示姓名需在 `cardHTML()` 加一个 span（新 class），CSS 再配样式。

## 9. 核对方法与可选 JS 改动点
- 行号用 read 逐段通读 L1–2378（跳过 L777–797 SheetJS）+ grep 全量核对；应用脚本 L799–2376 内 grep 计数：`.style.` 14 处（含 `setProperty` 2）、`cssText` 0、`style="` 19、`classList.` 18、`className` 5、`--cw/--ch` 0（CSS 侧 `--cw` 10 / `--ch` 2，均在死代码）；ID/选择器查询 73 处。
- 若允许改 JS（非必须）：L1204 overflow 可改 `visible`（需保留降级滚动）、L1291 内联色改 `var(--…)`、L1208 tiny 阈值可按新设计放宽、L1113–1121 卡片加姓名元素；L646 属 HTML 内联，需改 HTML 本身。
- CSS 级联注意：样式表内存在多轮覆盖（`.tile` L83→L448→L471；`.card/.grid` 死块在 L159–523），新拟物规则建议**追加在 L601 之前（样式表末尾）**并自带 media query，否则会被 L470–601 的后续声明覆盖。
