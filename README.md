# 在校高效系统（Campus Efficiency System）

> 高校作业考勤 / 清点系统。**单文件 HTML，零构建、零后端、离线可用**——双击就能用，数据只存在本机浏览器里。

一个给班级用的轻量点名与作业完成率统计工具：把学生名单导入进来，每天按科目清点完成情况，自动算完成率、导出 Excel 报表。

---

## 特性

- **清点**：点击学生卡片标记完成，已完成项保留原位；前 5 名显示 `1st`~`5th` 徽章
- **科目分栏**：一天 × 五科（语文 / 数学 / 英语 / 道法 / 历史），分「语数英」与「道法历史」两组，每科独立清点
- **完成率统计**：该生已完成天数 ÷ 有记录的清点天数（空记录日自动剔除，不稀释分母）
- **历史记录**：按日期回看每次清点
- **名单管理**：XLSX / CSV 导入，支持手动新增、删除、重置
- **导出**：一键生成 XLSX 报表（当日作业情况 / 完成率统计 / 历史清点记录 三张表）
- **新拟物化 UI**：光源统一左上，粉彩配色，按压 150ms 内陷
- **中英双语**：`zh_cn` / `en_us`

## 隐私设计

**界面全程只显示学号。** 姓名仅保存在浏览器 `localStorage`，既不渲染到界面，也不进任何导出表。

这是刻意的取舍：考勤数据属于个人信息，最小化暴露面比"显示全名更友好"更重要。

名单仅存在于使用者自己的浏览器中，页面没有后端、没有埋点、没有外发请求。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 浏览器 | 任意现代浏览器（Chrome / Edge / Firefox / Safari） |
| Node.js | 仅**验证脚本**需要（≥ 22），日常使用完全不需要 |

## 快速开始

直接用浏览器打开 `在校高效系统v0.2.2.html` 即可。

如需通过 HTTP 访问（部分浏览器对 `file://` 下的模块加载有限制）：

```bash
npx serve .
# 或
python -m http.server 8080
```

## 目录结构

```
├── 在校高效系统v0.2.2.html      # 主交付物：单文件应用（含内联 SheetJS，离线可用）
├── backup/
│   └── 在校高效系统v0.2.1-原版备份.html  # 新拟物化改版前的原版备份
└── .workbuddy/
    ├── neumorph/               # 新拟物化主题工具链
    │   ├── theme.css           # 主题唯一真源（设计令牌 + 组件样式）
    │   ├── splice.js           # 把 theme.css 回灌进 HTML 的 <style> 块
    │   ├── check-final.js      # 交付前静态自检（ALL PASSED 才算过）
    │   ├── patch-html.js       # HTML 补丁脚本
    │   └── audit-js.md         # JS / 内联样式 / 布局审计报告
    ├── verify/                 # Edge headless 截图与功能回归基线
    │   ├── README.md           # 验证工具用法与故障排查
    │   ├── run.js / compare.js # 跑基线 → 与基线对比（退出码 0 = PASS）
    │   ├── smoke.js            # 冒烟测试
    │   ├── static-check.js     # 静态自检
    │   └── run-before.cmd / run-after.cmd
    └── memory/                 # 分轮开发日志（设计与踩坑记录）
```

### 主题真源约定

`theme.css` 是新拟物化主题的**唯一真源**。改样式时改 `theme.css`，再跑：

```bash
node .workbuddy/neumorph/splice.js "在校高效系统v0.2.2.html"
```

回灌进 HTML 的 `<style>` 块。**回灌前务必先 diff HTML 的样式块与 `theme.css`**——手工改动 HTML 里的令牌而不同步回 `theme.css`，会被下一次回灌静默覆盖。

## 验证

静态自检：

```bash
node .workbuddy/neumorph/check-final.js
```

回归验证（改版前后截图对比）：

```bash
cd .workbuddy/verify
node run.js --out before   # 跑基线
# ... 改代码 ...
node run.js --out after    # 跑新版本
node compare.js            # 退出码 0 = 无回归
```

> 验证脚本依赖 Edge headless + CDP，**必须在普通终端（PowerShell / cmd）里运行**，不能在本项目的沙箱环境中执行（Chromium 的 Mojo 命名管道会被沙箱拒绝）。详见 [.workbuddy/verify/README.md](.workbuddy/verify/README.md)。

## 技术要点

- **零依赖 XLSX 导出**：手写 OOXML + STORE 模式 ZIP（30/46 字节头 + EOCD + CRC32 表），`Blob` 直接下载。Excel 可正常打开三张表。
- **XLSX 导入**：SheetJS 内联在 HTML 中（因此完全离线可用）；CDN 四级回退（jsdelivr → unpkg → cdnjs → staticfile），全失败时回退到内置 CSV 解析（兼容 BOM / 引号 / Tab）。
- **表头识别**：正则匹配「学号 / 学籍号 / ID」「姓名 / 名字」，识别不到则按列特征启发式推断。
- **数据模型**：`{students:[{sid,name,addedAt}], days:{'YYYY-MM-DD':{order:[sid],times:{sid:ts}}}}`

## 许可

个人项目，随意使用与修改。
