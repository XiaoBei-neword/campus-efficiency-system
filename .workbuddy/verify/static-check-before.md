# 静态检查报告 · before

- 文件：`C:\Users\shanxin\Desktop\在校高校系统\在校高效系统v0.2.1.html`
- 大小：988316 B，2379 行，sha256 `5fd023e70ee2a6fd…`
- 生成时间：2026-11-08T14:05:37.695Z

## a. 结构与花括号配平

| 项 | 值 |
| --- | --- |
| `<style>` 块数 | 1 |
| `<script>` 块数 | 3 |
| style#1 行 | 8 ~ 602（30967 B） |
| script#1 行 | 740 ~ 757（668 B） |
| script#2 行 | 775 ~ 798（639147 B） SheetJS |
| script#3 行 | 799 ~ 2376（63621 B） **app** |
| CSS 花括号 | open=360, close=360, **配平=OK** |
| app JS 花括号(启发式) | open=381, close=381, **配平=OK** |
| CSS 规则数 / 字节 | 344 / 30967 |
| `!important` 数 | 3 |

媒体查询：`@media (max-width:900px)`@531、`@media (max-width:620px)`@540、`@media (max-width:1024px)`@558、`@media (max-width:860px)`@563、`@media (max-width:620px)`@576、`@media (hover:none)`@591、`@media (max-width:620px)`@595、`@media (prefers-reduced-motion:reduce)`@599

## b. live CSS class 覆盖率

- CSS 定义 class：**141**；HTML/JS 使用 class：**101**（HTML 47 / JS 57）
- 使用中且有样式：**100/101**
- 有样式且被使用：**100/141**

### 使用但缺 CSS 样式的 class（1）
- `.sb`（可能是动态拼接前缀：.sb2 .sb3 .sb4 .sb5）

### 死 CSS class · 旧版 #grid 体系疑似遗留（23）
`.anim`、`.card`、`.card-head`、`.card-mid`、`.del`、`.dot`、`.grid`、`.lbl`、`.nm`、`.no`、`.no-rate`、`.no-state`、`.no-time`、`.pill`、`.rank`、`.rate`、`.rate-track`、`.rate-val`、`.seq`、`.sid`、`.st-time`、`.state`、`.yes`

### 死 CSS class · 其他未被静态引用（1）
`.info`

### 动态/参数类白名单（静态不可判定，不计死类）：`.bad`、`.btn-danger`、`.dim`、`.full`、`.good`、`.hi`、`.just`、`.ok`、`.r1`、`.r2`、`.r3`、`.r4`、`.r5`、`.sb2`、`.sb3`、`.sb4`、`.sb5`

## c. 旧配色残留

| 颜色 | 总计 | CSS | JS | HTML | 其中主题 token(@:root) | **残留(非 token)** |
| --- | --- | --- | --- | --- | --- | --- |
| `#12385a` | 6 | 6 | 0 | 0 | 1 | **5** |
| `#1a5b8d` | 3 | 3 | 0 | 0 | 1 | **2** |
| `#0f2740` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#14476f` | 1 | 1 | 0 | 0 | 0 | **1** |
| `#c62828` | 8 | 8 | 0 | 0 | 1 | **7** |
| `#16a34a` | 6 | 6 | 0 | 0 | 1 | **5** |
| `#12813f` | 5 | 4 | 1 | 0 | 0 | **5** |
| `#e0a13a` | 2 | 1 | 0 | 1 | 0 | **2** |
| `#f1f5f9` | 1 | 1 | 0 | 0 | 1 | **0** |
| `#ffffff` | 24 | 24 | 0 | 0 | 1 | **23** |

旧配色合计：56 处，其中 :root 主题 token 6 处，**残留 50 处**。

残留位置（最多列 80 条）：

- L1291 [js] `#12813f` — '<span class="num" style="font-weight:600;color:' + (p >= 80 ? '#12813f' : '#4a6a86') + '">' + p + '%</span></td>' +
- L646 [html] `#e0a13a` — <div class="bar"><i id="stLeftBar" style="width:0%; background:linear-gradient(90deg,#f3cf95,#e0a13a)"></i></div>
- L555 [css] `#c62828` — background:#fff2f0; color:#c62828; font-size:24px; font-weight:700; margin-bottom:16px; border:1px solid #f6d5d1}
- L548 [css] `#ffffff` — .unsupported-card{max-width:540px; background:#fff; border:1px solid var(--line); border-radius:18px;
- L443 [css] `#16a34a` — .hk{color:#16a34a; font-weight:800; font-size:13px}
- L435 [css] `#12385a` — .hist-sum b{font-family:var(--mono); color:#12385a; margin-right:6px}
- L433 [css] `#ffffff` — .hd.on{background:var(--navy); border-color:var(--navy); color:#fff}
- L430 [css] `#ffffff` — .hd{border:1px solid var(--line); background:#fff; border-radius:8px; padding:6px 11px;
- L424 [css] `#12813f` — .tbl td.ok{color:#12813f; font-weight:700}
- L421 [css] `#ffffff` — .row-del{border:1px solid #f0d5d3; background:#fff; color:#b3261e; font-size:11.5px;
- L400 [css] `#ffffff` — .scard.done .sc-n{color:#fff; text-shadow:0 1px 2px rgba(6,60,30,.18)}
- L388 [css] `#ffffff` — border:1px solid var(--line); border-radius:9px; background:#fff;
- L378 [css] `#12385a` — .subj-name{font-size:13px; font-weight:800; color:#12385a; letter-spacing:3px}
- L377 [css] `#ffffff` — padding:7px 13px; border-bottom:1px solid var(--line); background:linear-gradient(180deg,#f7fbff,#fff)}
- L360 [css] `#12385a` — .ssw.active{background:#fff; color:#12385a; box-shadow:0 1px 3px rgba(18,56,90,.16)}
- L360 [css] `#ffffff` — .ssw.active{background:#fff; color:#12385a; box-shadow:0 1px 3px rgba(18,56,90,.16)}
- L359 [css] `#12385a` — .ssw:hover{color:#12385a}
- L342 [css] `#c62828` — .toast.bad .ti{color:#c62828}
- L341 [css] `#16a34a` — .toast.good .ti{color:#16a34a}
- L336 [css] `#ffffff` — padding:8px 16px; border-radius:10px; color:#1f3448; background:#fff;
- L300 [css] `#12385a` — .opt input{margin:3px 0 0; accent-color:#12385a; width:16px; height:16px; flex:none; cursor:pointer}
- L292 [css] `#c62828` — .field .err{min-height:16px; font-size:11.5px; color:#c62828; margin-top:5px}
- L291 [css] `#ffffff` — .field input[type=text]:focus{border-color:#79b0dd; box-shadow:0 0 0 3px rgba(47,140,209,.13); background:#fff}
- L275 [css] `#ffffff` — width:min(500px,100%); background:#fff; border-radius:18px; overflow:hidden;
- L256 [css] `#12813f` — .pill.yes{background:var(--ok-soft); color:#12813f}
- L254 [css] `#16a34a` — .mini-bar.hi i{background:linear-gradient(90deg,#7ddba0,#16a34a)}
- L225 [css] `#ffffff` — background:radial-gradient(circle at 50% -10%,#f6fbff,#fff 62%);
- L219 [css] `#12813f` — .card.full .rate-val{color:#12813f}
- L217 [css] `#16a34a` — .card.done .rate-track i{background:linear-gradient(90deg,#7ddba0,#16a34a)}
- L201 [css] `#16a34a` — .card.done .dot{background:#16a34a; box-shadow:0 0 0 3px rgba(22,163,74,.13)}
- L196 [css] `#c62828` — .del:focus-visible{opacity:1; background:#fdecea; color:#c62828; outline:none}
- L195 [css] `#c62828` — .del:hover{background:#fdecea; color:#c62828}
- L173 [css] `#ffffff` — background:linear-gradient(180deg,#f3fcf6 0%,#ffffff 62%);
- L152 [css] `#ffffff` — .btn:disabled:hover{border-color:var(--line); background:#fff}
- L149 [css] `#ffffff` — .btn-ghost-danger{color:#b3261e; border-color:#f0d5d3; background:#fff}
- L147 [css] `#c62828` — .btn-danger{background:#c62828; border-color:#c62828; color:#fff}
- L147 [css] `#c62828` — .btn-danger{background:#c62828; border-color:#c62828; color:#fff}
- L147 [css] `#ffffff` — .btn-danger{background:#c62828; border-color:#c62828; color:#fff}
- L145 [css] `#ffffff` — .btn-primary{background:var(--navy); border-color:var(--navy); color:#fff}
- L139 [css] `#ffffff` — background:#fff; color:#25425a; font-size:13.5px; font-weight:600;
- L132 [css] `#ffffff` — background:#fff; color:var(--text); outline:none; transition:.18s;
- L125 [css] `#ffffff` — .tab.active{background:#fff; color:var(--navy); box-shadow:0 1px 4px rgba(18,56,90,.16)}
- L117 [css] `#ffffff` — background:linear-gradient(180deg,#fbfdff,#fff);
- L101 [css] `#1a5b8d` — .bar i{display:block; height:100%; border-radius:4px; background:linear-gradient(90deg,#7fb2dd,#1a5b8d); transition:width .5s cubic-bezier(.4,0,.2,1)}
- L98 [css] `#12813f` — .tile.t-ok .v{color:#12813f}
- L89 [css] `#e0a13a` — .tile.t-wait::before{background:#e0a13a; opacity:.6}
- L73 [css] `#ffffff` — letter-spacing:1.5px; font-variant-numeric:tabular-nums; color:#fff;
- L60 [css] `#ffffff` — .brand h1{margin:0; font-size:19px; font-weight:700; letter-spacing:.6px; color:#fff; white-space:nowrap}
- L42 [css] `#1a5b8d` — background:linear-gradient(120deg,#0c2740 0%,#14476f 52%,#1a5b8d 100%);
- L42 [css] `#14476f` — background:linear-gradient(120deg,#0c2740 0%,#14476f 52%,#1a5b8d 100%);

硬编码颜色总览：唯一 hex 126 种；rgb()/rgba() 41 处；hsl()/hsla() 0 处。Top 颜色见 JSON `colors.inventoryTop30`。

主题 token（:root 变量）：`--bg`、`--danger`、`--line`、`--mono`、`--muted`、`--navy`、`--navy-2`、`--ok`、`--ok-soft`、`--radius`、`--shadow-md`、`--shadow-sm`、`--surface`、`--text`

> 定义了但没被 var() 使用的 token：`--danger`

## d. 内联样式清单

共 18 处 `style="..."`：视觉类（新主题应接管/可移除）**2**，布局度量类（需保留）**15**。

| 行 | 区域 | 分类 | 内容 |
| --- | --- | --- | --- |
| L641 | html | layout-dynamic | `width:0%` |
| L646 | html | visual-overridable | `width:0%; background:linear-gradient(90deg,#f3cf95,#e0a13a)` |
| L651 | html | layout-dynamic | `width:0%` |
| L1275 | js | layout-dynamic | `width:64px` |
| L1277 | js | layout-dynamic | `width:64px` |
| L1287 | js | layout-dynamic | `text-align:center` |
| L1290 | js | layout-dynamic | `width:' + p + '%` |
| L1291 | js | visual-overridable | `font-weight:600;color:' + (p >= 80 ? '#12813f' : '#4a6a86') + '` |
| L1307 | js | layout-dynamic | `margin-top:8px` |
| L1307 | js | layout-dynamic | `width:' + p + '%` |
| L1321 | js | layout-dynamic | `overflow:auto; margin-top:10px` |
| L1507 | js | other | `font-family:inherit` |
| L2173 | js | layout-dynamic | `flex:none;margin-top:1px` |
| L2230 | js | layout-dynamic | `text-align:center;width:70px` |
| L2230 | js | layout-dynamic | `text-align:left` |
| L2241 | js | layout-dynamic | `text-align:center` |
| L2242 | js | layout-dynamic | `text-align:left` |
| L2265 | js | layout-dynamic | `margin-top:4px` |

JS 运行时写样式（`.style.xxx =`，需保留）：
- L1085 `width` = pct(st.rate) + '%'
- L1086 `width` = st.total ? (st.left / st.total * 100) + '%' : '0%'
- L1087 `width` = pct(st.rate) + '%'
- L1168 `gridTemplateColumns` = ''
- L1168 `gridTemplateRows` = ''
- L1202 `gridTemplateColumns` = 'repeat(' + useC + ', ' + fix(cw) + ')'
- L1203 `gridTemplateRows` = 'repeat(' + rows + ', ' + fix(ch) + ')'
- L1204 `overflow` = scrollable ? 'auto' : 'hidden'
- L1205 `alignContent` = scrollable ? 'start' : 'center'
- L1444 `overflow` = 'hidden'
- L1452 `overflow` = ''
- L1828 `display` = 'none'

## e. JS 注入布局变量 --sw / --sh

| 项 | 次数 |
| --- | --- |
| CSS `var(--sw)` | 3 |
| CSS `var(--sh)` | 1 |
| JS `setProperty(--sw)` | 1 |
| JS `setProperty(--sh)` | 1 |

结论：**保留 ✅（JS 注入 + CSS 消费都在）**
