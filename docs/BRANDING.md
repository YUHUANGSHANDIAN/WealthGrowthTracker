# 品牌与命名矩阵

本文件说明「WealthGrowthTracker」统一命名中**哪些改、哪些必须保留**，供实现与评审对照。
不含任何个人路径、账号或凭据。

## 1. 用户可见名称（统一为 WealthGrowthTracker）

| 位置 | 目标 |
|---|---|
| 窗口标题、启动画面、托盘、About | `WealthGrowthTracker`（可附中文副标题） |
| HTML `<title>`、PWA `name` / `short_name` | `WealthGrowthTracker` |
| README 主标题、当前版本文档、下载说明 | `WealthGrowthTracker` |
| GitHub 仓库名（原地改名） | `WealthGrowthTracker` |
| 安装包展示名、快捷方式名 | `WealthGrowthTracker` |
| 子功能 | `WealthGrowthPlanner`，中文标签「月度理财」 |

## 2. 必须保留的内部标识（兼容白名单）

| 标识 | 位置 | 保留原因 |
|---|---|---|
| `com.yuhuangshandian.wealthgrowthtracker` | `src-tauri/tauri.conf.json` identifier | 关联系统 bundle 与 WebView 数据目录；更换会让系统视为新应用并丢失旧设置 |
| `wealth_tracker_data` 等旧存储键 | `src/constants/storageKeys.ts` | 与旧版逐字对齐的数据兼容契约 |
| `wealth-growth-tracker`（IndexedDB 库名） | `src/services/storage/indexedDb.ts` | 改名会读不到既有浏览器数据 |
| `wealth-growth-tracker-shell-*`（SW 缓存前缀） | `public/sw.js` | 缓存归属判断依赖该前缀 |
| `wealth-growth-tracker`（npm `name`） | `package.json` | 内部包名，非用户可见；改名需同步 lockfile 且无收益 |
| `wealth-growth-tracker` / `wealth_growth_tracker_lib`（Cargo crate/lib） | `src-tauri/Cargo.toml` | 工具链内部标识，重命名需同步全部引用 |
| `productName: WealthGrowthTracker` | `src-tauri/tauri.conf.json` | 已与目标品牌一致 |

白名单项的验收口径是「用户可见品牌一致、内部兼容有说明」，而不是要求全库搜索旧字符串为 0。

## 3. 单一配置来源

`src/constants/brand.ts` 提供品牌名、中文名、仓库 slug 与旧 slug 回退；窗口、HTML、manifest、About、更新检查从它派生，
避免继续到处硬编码 slug。更新检查先请求新 slug，失败时回退旧 slug（改名后的 301 重定向由 GitHub 负责）。

## 4. 不做的事

- 不重写已发布 tag、commit 历史或 Release。
- 不为美观改动 identifier、存储键、数据库名或缓存前缀。
- 不替换用户自定义标题、渠道名或历史证据文件中的原始文本。
- 不在改名过程中删除旧安装；先验证新安装可启动、可读旧数据，再移除旧副本。
