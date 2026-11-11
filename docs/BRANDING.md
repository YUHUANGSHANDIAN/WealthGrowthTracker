# 品牌与命名合同

当前用户可见产品名只有一个：`WealthGrowthTracker`。

## 必须统一

| 对象 | 标准 |
|---|---|
| 窗口、启动画面、About、PWA、HTML title | `WealthGrowthTracker` |
| npm package | `wealthgrowthtracker` |
| AI Runtime package | `wealthgrowthtrackerairuntime` |
| Rust package / library | `wealthgrowthtracker` / `wealthgrowthtracker_lib` |
| Tauri `productName` / `mainBinaryName` | `WealthGrowthTracker` / `WealthGrowthTracker` |
| Windows 主程序 | `WealthGrowthTracker.exe` |
| Release 标题、当前版文档、README | `WealthGrowthTracker` |
| CI 和 Release asset | 以 `WealthGrowthTracker` 为品牌前缀 |

`mainBinaryName` 不写入 `.exe`；扩展名由 Tauri 附加。

## 必须保留的兼容标识

| 标识 | 原因 |
|---|---|
| `com.yuhuangshandian.wealthgrowthtracker` | 已发布 Tauri identifier；更换会被系统视为新应用 |
| `wealth_tracker_data` 等存储键 | 旧版本地数据契约 |
| `wealth-growth-tracker` IndexedDB 名 | 旧浏览器数据定位 |
| `wealth-growth-tracker-shell-*` | Service Worker 缓存归属 |
| `wealth-growth-tracker-full-backup` | 旧完整备份格式 |
| `wealth-growth-tracker-attachment-archive` | 旧附件归档格式 |
| `wealth-growth-tracker` keyring service | 旧 AI 凭据定位 |
| `YUHUANGSHANDIAN/wealth-growth-tracker` | 旧仓库更新检查回退 |
| `wealth-growth-tracker.exe` | 仅用于精确识别、清理和升级兼容 |
| `财富成长记`默认目录名 | 仅用于升级前默认数据目录兼容读取 |
| Linux 工具链小写包名 | DEB/RPM 元数据由 Tauri/系统工具链规范化；Release 文件名仍使用品牌前缀 |

这些标识不得作为新的当前品牌扩散。新增用户可见文案不得使用旧名称。

## 默认数据目录

新安装使用 `Documents/WealthGrowthTracker`。如果新目录尚未存在、旧默认目录存在，则应用继续原地读取旧目录并显示兼容提示；不会静默移动或删除。

## 只读基线与历史

历史 Tag、Release、提交和审计文档不因改名而重写。旧 Release 标题保留原样；新 Release 必须使用 `WealthGrowthTracker`。
