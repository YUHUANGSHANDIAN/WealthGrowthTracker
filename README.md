# 财富成长记 / 财富梦想实现家

一个**本地优先**的个人财富管理应用：通过可视化资产、成长等级、目标倒计时和游戏化反馈（金币雨），让个人财富积累过程更有动力、更有仪式感。

本项目是从灵光 AI 导出的生产产物（压缩后的 React bundle）**完整重建**的可维护源码工程——不再依赖灵光运行时，可在普通现代浏览器中独立运行，也可作为 **Windows 桌面应用**（Tauri 2）安装使用。

> ⚠️ 本应用是个人记账/目标管理工具，其中的「AI 分析」「财富预测」均为**本地规则算法**，仅对历史数据做数学外推，**不构成任何投资收益建议或保证**。

---

## ✨ 功能

- **资产管理**
  - 父渠道 / 子渠道两级结构（默认提供支付宝、微信、华为钱包、校园卡、银行卡、京东金融，可自由增删改）
  - **无损父子转换**：添加首个子渠道时可选择已有直接金额归属（转入新子渠道 / 创建「未分类」/ 清空），删除最后一个子渠道时显式选择金额处理，默认保持总资产不变
  - 单字段排序、多维排序、自定义排序规则、**智能综合排序**（金额/增长/活跃/更新时间加权，可解释）、渠道置顶
- **财富等级体系**
  - 8 级财富等级（理财新手 → 百万富翁），每级有独立**动态主题**（CSS Variables 全局生效）
  - 等级体系查看器、等级详情、里程碑、升级庆祝动画
- **历史记录**
  - 按天记录总资产，自动同步今天的数据点；渠道快照 + 财富等级 + 时间戳
  - 手动增删改、批量管理、日期范围筛选、趋势图
- **财务报告**
  - 周报 / 月报 / 年报，自动计算期初/期末、变化量、变化率、极值/均值（过去周期用历史快照）
  - **层级资产构成（Report Schema v3）**：父渠道 rollup + 子渠道 breakdown，点击父渠道展开子渠道明细（占父渠道 / 占总资产），绝不父子 double-count
  - **Data As Of**：报告记录数据快照截止日期（该周期最后有效记录），不虚构真正月末值
  - 报告搜索、类型筛选、归档、批量管理、JSON 批量导出
  - **报告分享**：PNG/JPEG/WebP 图片、复制到剪贴板、微信分享、邮件、系统分享（分享图展示父子层级）
- **数据分析**
  - 历史趋势图、渠道对比、资产构成、2D 雷达图（增长趋势 / 拟合质量 / 数据规则性）
- **财富预测**（本地规则算法，非投资建议）
  - 线性 / 指数 / 保守情景 / 积极情景 / 混合 五种模型，统一真实时间轴
  - 95% 预测区间、多时间跨度（1月~2年）、目标金额到达估计
  - rolling-origin 回测 + MAE / RMSE / sMAPE 诊断、模型比较、残差图
  - **图表控制**：显示范围 / 时间维度 / 训练窗口 / 图表样式 / 显示项开关（持久化）
- **目标与激励**
  - 百万财富目标、**时区感知倒计时**（起始/目标日期时间、多种显示格式、时间+金额双进度）
  - 达成目标自动触发金币雨 + 升级庆祝（遵循 `prefers-reduced-motion`）
- **数据管理**
  - JSON 全量导出 / 导入（**合并/覆盖两种模式** + 预览），**兼容灵光旧版备份 JSON**
  - **数据健康检查**（可安全修复）、渠道/历史 CSV 导出、自动备份 + 从备份恢复
  - **报告覆盖情况** + 缺失月报补生成（使用当月最后有效记录，绝不重复生成、绝不虚构月末值）
  - **匿名诊断导出**（只含版本 / schema / 各域数量 / 健康问题类型，不含任何敏感数据）
  - **历史报告导入器**（TXT / 图片配对解析 + 与现有数据 reconciliation）
- **设置与账户**
  - 个人资料、外观、**本地账户锁**（PBKDF2，不明文，登出不删除资产）、手动版本更新检查、隐私说明

---

## 🛠 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| 状态 | Zustand（单一 store，按领域拆分 action） |
| 样式 | Tailwind CSS 3 |
| 图表 | 自研轻量 SVG（折线 / 条形 / 雷达，无重型图表库） |
| 桌面 | Tauri 2（Windows x64，文件持久化 + 自动备份） |
| 测试 | Vitest + Testing Library |

刻意**不引入**的依赖：`three.js`（3D 雷达改用 2D SVG）、`math.js`（用少量纯函数替代）、`recharts/echarts`（自研 SVG 足够且更轻）。核心纯逻辑无副作用，便于单测。

---

## 🚀 本地运行

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器（默认 http://localhost:5173）
```

## 🏗 构建 & 测试

```bash
npm run build         # 类型检查 + 生产构建，产物在 dist/
npm run preview       # 本地预览生产构建
npm run typecheck     # 仅类型检查
npm run lint          # ESLint
npm test              # 运行单元测试（Vitest）
npm run privacy:check # 发布前隐私检查（阻止用户数据/备份/Excel/历史报告进入 Git）
```

---

## 💾 数据保存在哪里

所有资产数据**默认只保存在你自己的电脑本地**，不会上传到任何服务器：

- **Windows 桌面版**：`C:\Users\<用户名>\Documents\财富成长记\`（即「我的文档」下的 `财富成长记` 文件夹）
  - `data/app-state.json` —— 全部业务数据
  - `backups/` —— 自动/手动备份
  - `reports/{weekly,monthly,yearly}/` —— 报告（JSON + HTML）
  - `exports/` —— 导出的文件
- 普通浏览器：`localStorage`
- 灵光小应用环境：若检测到 `window.lingguang.storage`，自动复用其存储 API 与**相同的存储键**

存储键与灵光旧版逐字对齐（`wealth_tracker_data`、`financial_reports`、`countdown_data` 等），是数据兼容的核心契约。

> 提示：复制整个 `财富成长记` 文件夹即可完成完整人工备份。桌面版每天首次保存时自动备份一次。

---

## 🔁 数据导入 / 导出

- **导出**：在「数据」页点击「导出 JSON 备份」，生成 `wealth_tracker_backup_<时间戳>.json`。
- **导入**：在「数据」页选择 JSON 文件 → 预览内容 → 确认覆盖导入。

导入会做 schema 校验与字段归一化（缺失字段回退安全默认值），并保留版本号以支持未来迁移。

---

## 📦 如何从灵光旧版本迁移

1. 在**旧版灵光 App** 中导出数据为 JSON 文件。
2. 在**新版**「数据」页选择该 JSON 文件导入。

新版导出格式与旧版一致（`version: "1.0.0"` + `appInfo` + `data.wealth_tracker_data` 等），并**额外**附带金币雨/图表/排序历史等设置，实现完整往返；旧版导入时会自动忽略这些额外字段，因此**双向兼容**。

旧版导出的产物（`财富梦想实现家.html`、`财富梦想实现家_files/`）已通过 `.gitignore` 排除在版本库之外，仅保留在本地作为参考，不会被删除或修改。

---

## 📁 项目目录结构

```
src/
  components/
    charts/          # 自研 SVG 图表（折线 / 条形 / 雷达）与配色
    ui/              # 通用 UI 原子组件（按钮 / 弹窗 / 表单 / 提示等）
  constants/         # 财富等级、默认渠道、存储键、预测模型元信息
  features/
    assets/          # 资产管理（渠道 CRUD、排序）
    history/         # 历史记录与趋势
    reports/         # 财务报告生成 / 列表 / 详情
    analysis/        # 对比 / 雷达
    prediction/      # 预测模型与本地 AI 推荐
    goals/           # 目标倒计时 / 金币雨设置
    data/            # 数据导入导出
    coinRain/        # 金币雨动画（canvas）
  services/
    storage/         # 存储适配层（浏览器 / 灵光）
    export/          # 备份构建、解析、迁移、下载
  store/             # Zustand 全局状态 + 持久化
  utils/             # 纯函数工具（金额 / 日期 / 数学 / 渠道）
  types/             # 领域类型定义
  App.tsx / main.tsx
tests/               # Vitest 单元测试
```

---

## 🌐 部署

### GitHub Pages / Vercel / Netlify

项目 `vite.config.ts` 已配置 `base: './'`（相对路径），可直接部署到任意子路径。

```bash
npm run build        # 产物在 dist/
```

- **GitHub Pages**：将 `dist/` 作为发布源（或用 `gh-pages` 等把 `dist` 推送到 `gh-pages` 分支）。
- **Vercel / Netlify**：构建命令 `npm run build`，输出目录 `dist`。

纯静态站点，无需服务器或环境变量。

---

## 📥 平台下载

所有安装包都在 [GitHub Releases](../../releases) 页面，随 `SHA256SUMS.txt` 一起发布。各平台数据存储、导入导出、分享、更新支持情况见 [PLATFORM_SUPPORT.md](docs/PLATFORM_SUPPORT.md)。

### Windows（Stable）

- `WealthGrowthTracker_*_x64-setup.exe`（NSIS，按用户安装、无需管理员权限，推荐）
- `WealthGrowthTracker_*_x64.msi`
- 数据目录：`文档\财富成长记\`。卸载**不会**删除该目录。
- 首次安装 SmartScreen 可能提示「未知发布者」：点击「更多信息 → 仍要运行」即可（当前未商业代码签名）。

### macOS（Stable build，未签名）

- `WealthGrowthTracker_*_universal.dmg`（Apple Silicon + Intel 通用）。
- **当前为 ad-hoc 未签名构建**：首次打开若被 Gatekeeper 拦截，请在「系统设置 → 隐私与安全性」中点击「仍要打开」。正式 Developer ID 签名 + 公证见 `docs/FUTURE.md`。

### Linux（Stable）

- `WealthGrowthTracker_*_x86_64.AppImage`：`chmod +x *.AppImage` 后运行。
- `*.deb`：系统安装器或 `sudo apt install ./xxx.deb`。
- `*.rpm`：`sudo rpm -i xxx.rpm`。

### Android（构建可用，正式签名待配置）

- `*.apk`：从 GitHub Release 下载安装，需允许「安装未知来源应用」。
- 当前 APK 为 **debug 签名的预览版**；正式 release 签名（Play Store / 通用 AAB）待配置密钥后提供。

### Web / PWA（Stable）

- 直接部署 `dist/`（`base: './'` 已配置相对路径），可安装为 PWA（离线外壳）。
- 浏览器数据存于 `localStorage`，跨设备不互通（本应用无云同步）。

### HarmonyOS（见 docs/HARMONYOS.md）

- **无 Stable 原生 HAP**：Tauri 官方尚未 stable 支持 HarmonyOS。
- 提供 **Web/PWA 兼容方案**（HarmonyOS 兼容浏览器可安装 PWA 使用）。

---

## 🔒 隐私说明

- 所有个人资产数据**仅存储在你自己的电脑本地**，默认不上传任何服务器。
- 「AI 分析」为本地规则算法，**不联网、不调用第三方 LLM、不含任何 API Key**。
- 不接入任何追踪 / 广告 / 统计脚本；日志不记录任何金额/资产数据。
- 建议定期导出 JSON 备份（桌面版会自动备份）。

### 本地账户说明

- 「本地账户 / 登录」是**本地应用锁**，不是云账号；PIN/密码用 Web Crypto PBKDF2 + 随机盐保存，**不明文存储**。
- **PIN 锁不等于磁盘数据加密**：`app-state.json` 仍为普通本地 JSON。真正的加密见 `docs/FUTURE.md`。
- 登出只结束当前会话，**绝不删除资产数据**。

### 微信分享说明

- 微信分享采用「**复制报告图片到剪贴板 → 打开微信粘贴发送**」的工作流；不存在安全可靠的系统级微信直连协议，本应用**不会假装已分享**。

### 版本更新检查

- 仅在用户**主动点击「检查更新」**时访问 GitHub API（查询 Latest Release），绝不发送任何资产/渠道/历史/个人资料数据。

---

## 🧪 测试覆盖

重点覆盖纯业务逻辑：

- 金额精度（浮点误差）、格式化、解析
- 线性回归 / log-linear / 误差指标（MAE/RMSE/sMAPE）/ 分位数 / 可复现 PRNG
- 渠道金额汇总、CRUD、排序
- 日期（周/月/年边界、倒计时天数）
- 预测引擎（真实时间轴、线性/指数拟合、情景、混合回测、预测区间、bootstrap 可复现、目标到达、数据质量，19 项）
- 报告生成（当前周期用现值 / 过去周期用历史快照 / 旧数据标记缺失）
- 导入导出往返、旧版 1.0.0 备份兼容、非法输入拒绝
- 桌面文件存储（首次启动 / 原子写 / 损坏恢复 / 自动备份轮换 / 恢复 / 报告写盘）
- 渠道面板渲染冒烟测试

---

## 📄 License

MIT（可自行补充许可信息）。
