# 在校高效系统 · Edge headless 截图 / 功能回归基线

改版（新拟物化）前后各跑一次 `run.js`，用同一套断言与截图对比，确保「只是变好看，功能没坏、布局没塌」。
本目录所有脚本**零 npm 依赖**（Node ≥ 22 自带 WebSocket/fetch），不安装任何包、不起本地 server（用 `file://`）。

> ⚠️ **必须在非 DSH 沙箱的普通终端（PowerShell / cmd）里运行。**
> DSH workspace-write 沙箱禁止命名管道，Chromium 启动时创建 Mojo 通道会被拒绝，Edge 会直接以
> `FATAL:mojo\public\cpp\platform\platform_channel.cc:187 Check failed ... 拒绝访问 (0x5)` 退出。
> 这是环境限制，不是脚本问题（详见文末「故障排查」）。

---

## 1. 一键运行（普通终端）

```bat
cd /d "C:\Users\shanxin\Desktop\在校高校系统\.workbuddy\verify"
node run.js --out before
```

如果普通终端里没有 `node`，用本机自带的绝对路径：

```bat
"C:\Users\shanxin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" run.js --out before
```

也可以直接双击 `run-before.cmd` / `run-after.cmd`（内部自动找 node）。

改版完成后：

```bat
node run.js --out after
node compare.js
```

`compare.js` 退出码 0 = PASS（无回归），1 = FAIL（打印具体回归项）。**判 FAIL 时以 `compare.js` 输出为准，不要只看截图。**

### 可选参数与环境变量

| 项 | 说明 |
| --- | --- |
| `--out before\|after` | 输出目录标签，默认 `before`；截图与 `baseline.json` 写入 `.workbuddy/verify/<out>/` |
| `--html <path>` | 被测 HTML，默认 `<WS_ROOT>/在校高效系统v0.2.1.html` |
| `--xlsx <path>` | 示例名单，默认 `<WS_ROOT>/示例学生名单_计算机2301.xlsx`（42 人） |
| `--edge <path>` | msedge.exe 路径；默认 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| `--port <n>` | DevTools 端口，默认由系统分配空闲端口 |
| `--dry-run` | 只校验文件/参数/注入表达式语法，不启动 Edge |
| 环境变量 `EDGE_BIN` | 等价于 `--edge` |
| 环境变量 `WS_ROOT` | 工作目录（默认本脚本上两级：`C:\Users\shanxin\Desktop\在校高校系统`） |

脚本启动的 Edge 一定带 `--headless=new --disable-gpu --allow-file-access-from-files`、独立 `user-data-dir=./profile`，
结束（含异常/Ctrl+C）时用 `taskkill /PID <pid> /T /F` 杀整棵进程树；`stdio` 一律 `ignore`（不会占用你的终端管道）。

---

## 2. 文件清单

| 文件 | 作用 |
| --- | --- |
| `run.js` | **主入口**：启动 Edge → 11 个场景截图 + 断言 → 写 `baseline.json`、`console-<out>.json`；打印进度与断言 JSON |
| `edge.js` | Edge 启动器：独立 profile、随机空闲端口、轮询 `/json/version` 等待就绪、退出时 taskkill 进程树 |
| `cdp.js` | 极简 CDP 客户端（浏览器级 WS + `Target.attachToTarget(flatten)` 会话），含 evaluate/waitForExpr/点击/真实文件上传/截图助手 |
| `compare.js` | before/after 基线对比：断言回归、截图缺失/尺寸变化、控制台新增错误、计算样式变化、行为观测差异；输出 PASS/FAIL |
| `static-check.js` | **纯静态检查（无需浏览器，沙箱里也能跑）**：花括号/标签、live class 覆盖率、旧配色残留、内联样式清单、`--sw/--sh` 保留检查 |
| `smoke.js` | 环境自检：只启动 Edge、打开页面截一张 `_smoke.png` 并打印页面状态，用于先确认 Edge 能跑 |
| `run-before.cmd` / `run-after.cmd` / `static-check.cmd` | 双击即用的包装脚本 |

---

## 3. 截图清单（每次运行 11 张）

| 文件 | 场景 | 视口 |
| --- | --- | --- |
| `01-empty.png` | 首屏空状态（未导入名单） | 1920×1080 |
| `02a-import-preview.png` | 导入确认弹窗（附加证据） | 1920×1080 |
| `02-main.png` | 导入 42 人后主界面，语数英 3 栏卡片 | 1920×1080 |
| `03-cards-done.png` | 语文/数学/英语各点 1 张卡片后的完成态 + 第 1 名徽章 | 1920×1080 |
| `04-stats-tab.png` | 顶部 tab 切「完成率统计」 | 1920×1080 |
| `05-soc-group.png` | 科目组切「道法历史」（2 栏） | 1920×1080 |
| `06-history-modal.png` | 工具栏「完成记录」弹窗 | 1920×1080 |
| `07-reset-modal.png` | 工具栏「重置」弹窗 | 1920×1080 |
| `08-add-modal.png` | 工具栏「新增学生」弹窗 | 1920×1080 |
| `09-search.png` | 搜索「202311010」有结果（9 人 × 3 科） | 1920×1080 |
| `10-mobile.png` | 移动端主界面 | 390×844 |

每张截图都会断言实际 PNG 尺寸（`screenshot.<id>.size`），同时记录字节数；截图前会等待 `document.fonts.ready`
与两帧 rAF、并等 toast 消失，保证画面稳定可对比。

---

## 4. 功能断言清单（baseline.json → assertions）

场景化（断言名带场景前缀，after 对比按断言名一一配对）：

- **00 setup**：Edge/DevTools 就绪、CDP attach、页面标题、内联 SheetJS 存在（`typeof XLSX !== undefined`）、清空 localStorage 并 reload 后回到空状态。
- **01 空状态**：`#empty` 显示、`#panels`/`#statsView` 隐藏、0 张卡片、顶部 4 个统计为 0、导入可用、导出禁用、无页面滚动。
- **02 导入**：`DOM.setFileInputFiles` 真实上传 xlsx → 预览弹窗识别 **42 人** → 点「确认导入」→ 3 栏（语文/数学/英语）、每科 42 张卡共 126、顶部 126/0/126/0%、`42 人 × 3 科`、localStorage `hw_attendance_v1` 学生数 42 / sourceName 正确 / 尚无清点记录、3 个科目面板高度/宽度合理、无页面滚动。
- **03 完成态**：点卡片后 `.scard.done` 共 3 张（每科 1）、3 个 `1st` 徽章、顶部 done=3/left=123/rate=2%、localStorage 当天每科 order=1、times=1。
- **04 统计 tab**：tab 激活、面板隐藏、统计表 42 行、9 列表头（序号/姓名/5 科/总完成率/操作）、4 张概览卡 + 1 张每日记录卡。
- **05 道法历史**：2 栏（道法/历史）、每科 42 卡共 84、顶部 84/0/0%、科目计数 `0 / 42`。
- **06 完成记录弹窗**：打开、宽弹窗、body overflow 隐藏、1 个日期、42 行表格、3 个 ✓、汇总含三科、弹窗在视口内；关闭按钮后恢复。
- **07 重置弹窗**：2 个选项、默认「仅清空今日清点」、ESC 可关、再次打开「取消」可关。
- **08 新增学生弹窗**：两个输入框、按钮「取消/确认新增」、空学号点确认提示「请输入学号」且弹窗不关、取消后学生数仍 42（无副作用）。
- **09 搜索**：输入 `202311010` → 27 张卡（9 人 × 3 科）、科目计数 `1 / 9`（每科已各完成 1 份）、顶部统计仍 126（不随过滤变）、无结果时 3 个「没有匹配」空态、清空后还原 126。
- **10 移动端**：390×844 生效、3 栏仍在、126 卡、无页面横/纵向滚动、board 底边在视口内。
- **全局**：截图尺寸、控制台 errors/warnings 数、运行期间主 HTML sha256 稳定（防止边改边跑）。
- 控制台采集：`Runtime.exceptionThrown` + `Runtime.consoleAPICalled(error/warning/assert)` + `Log.entryAdded(error/warning)`，写入 `console-<out>.json`。

`baseline.json` 还记录：环境（Edge 版本/端口/Node）、源文件 hash 与字节数、视口、截图元数据、断言列表、关键布局矩形、
**关键元素的计算样式快照**（`observations.styleDesktopMain` / `styleDesktopDone`：background/box-shadow/border-radius/字体等 9 个属性 × 22 个元素）——
`compare.js` 用它来提示「新拟物化主题是否真的生效」。行为观测（`observations.main/done/stats/...`）可对比数量变化。

---

## 5. 静态检查（不需要浏览器，沙箱内可直接跑）

```bat
node static-check.js --label before
node static-check.js --label after      :: 改版后跑，检查旧配色/内联样式残留是否清零
```

产物：`static-check-<label>.md`（人读）与 `.json`（机读）。检查内容：

- **a. 结构**：`<style>/<script>` 块位置、CSS 花括号配平、app JS 花括号（启发式）、CSS 规则数、`!important`、媒体查询清单；
- **b. live class 覆盖率**：HTML class 属性 + JS 模板/`className`/`classList` 提取 vs CSS 选择器，输出「使用但缺样式」「死类（旧版 #grid 体系 vs 其他）」「动态拼接白名单」；
- **c. 旧配色残留**：`#12385a #1a5b8d #0f2740 #14476f #c62828 #16a34a #12813f #e0a13a #f1f5f9 #ffffff` 逐色统计，
  区分 **`:root` 主题 token 允许项** 与 CSS/JS/HTML 残留，列出残留行号与上下文；附全部 hex 颜色总览；
- **d. 内联样式清单**：`style="..."` 逐条列行号/区域/内容并分类为「visual-overridable（新主题应接管/可移除）」
  与「layout-dynamic（布局/度量，需保留）」，另列 JS `.style.xxx =` 运行时写入（进度条宽度、布局网格等必须保留）；
- **e. `--sw/--sh`**：JS `setProperty('--sw'/'--sh')` 与 CSS `var(--sw)/var(--sh)` 是否都还在（单屏铺满的卡片尺寸依赖它们）。

### before 静态检查结果（2026-11-08，sha256 `5fd023e7…`）

- 结构：`<style>`×1（L8–602）、`<script>`×3（L740 兜底 / L775 SheetJS / L799 app）；CSS 花括号 **配平 OK**；344 条规则；`!important`×3。
- class：CSS 定义 **141**；HTML/JS 使用 **101**；使用中已有样式 **100/101**；缺样式 **1 = `.sb`**（动态拼接前缀，`.sb2~.sb5` 有样式，属正常）。
- 死类：旧版 `#grid` 卡片体系疑似遗留 **23 个**（`.card/.sid/.rank/.del/.nm/.seq/.st-time/.no-rate/...`），其他未被引用 **1 个**（`.info`）——
  新拟物化改版时可顺手清理，**改前改后都请确认这些 class 确实没有运行时生成**。
- 旧配色：总 56 处，`:root` 主题 token 允许 6 处，**残留 50 处**（`#ffffff`×23、`#c62828`×7、`#12385a`×5、`#16a34a`×5、`#12813f`×5、`#1a5b8d`×2、`#e0a13a`×2、`#14476f`×1）。
- 内联样式：18 处（视觉类 2、布局度量类 15、其他 1）；JS 运行时写样式 12 处。
- `--sw/--sh`：**保留 OK**（CSS `var(--sw)`×3、`var(--sh)`×1；JS `setProperty` 各 1）。
- 主题 token：`--bg --danger --line --mono --muted --navy --navy-2 --ok --ok-soft --radius --shadow-md --shadow-sm --surface --text`（`--danger` 定义但未被 `var()` 使用）。

> after 的目标不是「旧颜色一处不剩」，而是：**旧色只剩新主题的 token 定义**、内联视觉样式清零或迁入 CSS、死类清理后 class 覆盖率仍 100%、`--sw/--sh` 仍保留。

---

## 6. 已知基线 / 注意点

1. 截图里的**时钟和日期是实时的**，before/after 截图不可能字节一致；`compare.js` 不做像素比对，字节数变化只作提示。
2. `.sb`/`.sb1` 是 JS 动态拼接（`'sc-b sb' + rank`），CSS 只给 `.sc-b` 基础样式 + `.sb2~.sb5`，静态检查会提示，属**正常**。
3. 导入是真实的 `DOM.setFileInputFiles`（非伪造 File 对象）；列表解析走页内内联 SheetJS，不联网。
4. 所有点击用页面 `element.click()` 触发，与真实鼠标点击走同一事件链（无坐标依赖，更稳）；弹窗关闭同时覆盖按钮 / 遮罩 / ESC。
5. localStorage 键：`hw_attendance_v1`；`file://` 下需 `--allow-file-access-from-files`（脚本已带）。
6. 每次运行前脚本会清空 localStorage 并 reload，保证从空状态开始；`user-data-dir=./profile` 每次启动前会被清空。
7. 若 `after` 截图看起来「没变」：先看 `compare.js` 的「风格变化」统计（元素级计算样式 diff），再看 `static-check-after.md` 的旧配色残留。
8. 运行时若检测到主 HTML 的 sha256 在运行期间变化，`baseline.json` 会标记 `source.stableDuringRun=false`，该次基线作废重跑。

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Edge 立即退出，日志含 `FATAL:mojo\public\cpp\platform\platform_channel.cc:187 ... 拒绝访问 (0x5)` 或 crashpad `OpenProcess 拒绝访问` | **在 DSH 沙箱里运行**（命名管道被禁），任何 flag 组合都不行 | 换普通 PowerShell/cmd 窗口（非 DSH 工具会话）运行；先跑 `node smoke.js` 确认 |
| `等待 Edge DevTools 超时` | Edge 没起来 / 端口被占 / profile 被占用 | 关掉残留 `msedge.exe`；或用 `--port` 指定端口、等几秒重试 |
| 截图尺寸不是 1920×1080 / 390×844 | 系统缩放干扰 | 脚本已带 `--force-device-scale-factor=1` + `Emulation.setDeviceMetricsOverride`，若仍异常请回报 |
| 导入步骤等待超时 | 内联 SheetJS 缺失 / 文件路径不对 | 用 `--xlsx` 指定绝对路径；确认 `typeof XLSX !== "undefined"` 断言 |
| `compare.js` 报断言回归 | 改版影响了功能 | 看 `after/baseline.json` 中同名断言的 `expected/actual`，以及 `after/console-after.json` |
| `after` 提示「旧配色残留」不为 0 | 还有硬编码旧色 | 按 `static-check-after.md` 残留行号逐条替换为 `var(--token)` |

---

## 8. 目录产物示例

```
.workbuddy/verify/
├─ edge.js / cdp.js / run.js / compare.js / static-check.js / smoke.js
├─ README.md / run-before.cmd / run-after.cmd / static-check.cmd
├─ static-check-before.md / static-check-before.json
├─ profile/                        # Edge 临时 user-data-dir（可删）
├─ before/
│  ├─ 01-empty.png … 10-mobile.png
│  ├─ baseline.json
│  └─ console-before.json
└─ after/
   ├─ 01-empty.png … 10-mobile.png
   ├─ baseline.json
   └─ console-after.json
```
