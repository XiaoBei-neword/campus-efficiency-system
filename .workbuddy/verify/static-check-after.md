# 静态检查报告 · after

- 文件：`C:\Users\shanxin\Desktop\在校高校系统\在校高效系统v0.2.1.html`
- 大小：994797 B，2452 行，sha256 `92d35affb4c98872…`
- 生成时间：2026-11-08T14:09:29.757Z

## a. 结构与花括号配平

| 项 | 值 |
| --- | --- |
| `<style>` 块数 | 1 |
| `<script>` 块数 | 3 |
| style#1 行 | 10 ~ 675（37119 B） |
| script#1 行 | 813 ~ 830（668 B） |
| script#2 行 | 848 ~ 871（639147 B） SheetJS |
| script#3 行 | 872 ~ 2449（63587 B） **app** |
| CSS 花括号 | open=318, close=318, **配平=OK** |
| app JS 花括号(启发式) | open=381, close=381, **配平=OK** |
| CSS 规则数 / 字节 | 304 / 37119 |
| `!important` 数 | 3 |

媒体查询：`@media (max-width:1200px)`@593、`@media (max-width:1024px)`@598、`@media (max-width:900px)`@602、`@media (max-width:860px)`@613、`@media (max-width:620px)`@625、`@media (hover:none)`@666、`@media (prefers-reduced-motion:reduce)`@671

## b. live CSS class 覆盖率

- CSS 定义 class：**111**；HTML/JS 使用 class：**102**（HTML 47 / JS 58）
- 使用中且有样式：**100/102**
- 有样式且被使用：**100/111**

### 使用但缺 CSS 样式的 class（2）
- `.sb`（可能是动态拼接前缀：.sb2 .sb3 .sb4 .sb5）
- `.sep`

### 死 CSS class · 旧版 #grid 体系疑似遗留（0）
无

### 死 CSS class · 其他未被静态引用（1）
`.info`

### 动态/参数类白名单（静态不可判定，不计死类）：`.bad`、`.btn-danger`、`.dim`、`.good`、`.hi`、`.ok`、`.sb2`、`.sb3`、`.sb4`、`.sb5`

## c. 旧配色残留

| 颜色 | 总计 | CSS | JS | HTML | 其中主题 token(@:root) | **残留(非 token)** |
| --- | --- | --- | --- | --- | --- | --- |
| `#12385a` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#1a5b8d` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#0f2740` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#14476f` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#c62828` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#16a34a` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#12813f` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#e0a13a` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#f1f5f9` | 0 | 0 | 0 | 0 | 0 | **0** |
| `#ffffff` | 2 | 2 | 0 | 0 | 1 | **1** |

旧配色合计：2 处，其中 :root 主题 token 1 处，**残留 1 处**。

残留位置（最多列 80 条）：

- L348 [css] `#ffffff` — .empty.drag{border-color:rgba(110,156,196,.55);transform:scale(.997);box-shadow:inset -6px -6px 16px #fff, inset 6px 6px 18px rgba(110,156,196,.35)}

硬编码颜色总览：唯一 hex 114 种；rgb()/rgba() 167 处；hsl()/hsla() 0 处。Top 颜色见 JSON `colors.inventoryTop30`。

主题 token（:root 变量）：`--amber`、`--amber-2`、`--amber-ink`、`--bg`、`--bg-soft`、`--blue`、`--blue-2`、`--blue-ink`、`--danger`、`--danger-ink`、`--dur`、`--ease`、`--faint`、`--hi`、`--ink`、`--ink-2`、`--ink-strong`、`--inkc`、`--line`、`--line-2`、`--mint`、`--mint-2`、`--mint-ink`、`--mono`、`--muted`、`--ok`、`--ok-ink`、`--pink`、`--pink-2`、`--pink-ink`、`--radius`、`--radius-lg`、`--radius-sm`、`--sh`、`--sh-soft`、`--shadow-in`、`--shadow-in-sm`、`--shadow-out`、`--shadow-out-lg`、`--shadow-out-sm`、`--surface`、`--surface-2`、`--tint`

> 定义了但没被 var() 使用的 token：`--amber`、`--bg-soft`、`--blue`、`--danger`、`--hi`、`--line`、`--mint`、`--ok`、`--pink`、`--pink-ink`、`--radius`、`--radius-lg`、`--radius-sm`、`--sh-soft`、`--surface`、`--surface-2`

## d. 内联样式清单

共 17 处 `style="..."`：视觉类（新主题应接管/可移除）**0**，布局度量类（需保留）**16**。

| 行 | 区域 | 分类 | 内容 |
| --- | --- | --- | --- |
| L714 | html | layout-dynamic | `width:0%` |
| L719 | html | layout-dynamic | `width:0%` |
| L724 | html | layout-dynamic | `width:0%` |
| L1348 | js | layout-dynamic | `width:64px` |
| L1350 | js | layout-dynamic | `width:64px` |
| L1360 | js | layout-dynamic | `text-align:center` |
| L1363 | js | layout-dynamic | `width:' + p + '%` |
| L1380 | js | layout-dynamic | `margin-top:8px` |
| L1380 | js | layout-dynamic | `width:' + p + '%` |
| L1394 | js | layout-dynamic | `overflow:auto; margin-top:10px` |
| L1580 | js | other | `font-family:inherit` |
| L2246 | js | layout-dynamic | `flex:none;margin-top:1px` |
| L2303 | js | layout-dynamic | `text-align:center;width:70px` |
| L2303 | js | layout-dynamic | `text-align:left` |
| L2314 | js | layout-dynamic | `text-align:center` |
| L2315 | js | layout-dynamic | `text-align:left` |
| L2338 | js | layout-dynamic | `margin-top:4px` |

JS 运行时写样式（`.style.xxx =`，需保留）：
- L1158 `width` = pct(st.rate) + '%'
- L1159 `width` = st.total ? (st.left / st.total * 100) + '%' : '0%'
- L1160 `width` = pct(st.rate) + '%'
- L1241 `gridTemplateColumns` = ''
- L1241 `gridTemplateRows` = ''
- L1275 `gridTemplateColumns` = 'repeat(' + useC + ', ' + fix(cw) + ')'
- L1276 `gridTemplateRows` = 'repeat(' + rows + ', ' + fix(ch) + ')'
- L1277 `overflow` = scrollable ? 'auto' : 'hidden'
- L1278 `alignContent` = scrollable ? 'start' : 'center'
- L1517 `overflow` = 'hidden'
- L1525 `overflow` = ''
- L1901 `display` = 'none'

## e. JS 注入布局变量 --sw / --sh

| 项 | 次数 |
| --- | --- |
| CSS `var(--sw)` | 3 |
| CSS `var(--sh)` | 2 |
| JS `setProperty(--sw)` | 1 |
| JS `setProperty(--sh)` | 1 |

结论：**保留 ✅（JS 注入 + CSS 消费都在）**
