# 本地工作区与磁盘卫生（Workspace Hygiene）

本文档说明**本机**开发布局：仓库本身保持精简，构建缓存与一次性产物放到项目外部，
避免 `WealthGrowthTracker` 随开发反复膨胀。文档只描述规则与通用命令，不含任何个人
绝对路径；具体路径写在被 `.gitignore` 忽略的 `.wgt-local.json` 或 `WGT_CACHE_ROOT`
环境变量里。

仓库的规范目录名是 `WealthGrowthTracker`（可整体移动到同卷的任意位置，`.git` 内不含
绝对路径）；私人资料与外部缓存都在仓库之外，移动仓库本身不影响它们。

## 目标布局

```text
<工作区父目录>\
  <主工作区>\                 # 唯一主工作区（Git 权威仓库）
    src\  src-tauri\src\      # 源码
    node_modules\             # 唯一一份 JS 依赖
    ai-runtime\node_modules\  # AI 运行时依赖（唯一一份）

<外部缓存根>\                 # 由 .wgt-local.json 指定（本机绝对路径，不写入仓库）
  cargo\                      # CARGO_TARGET_DIR：桌面构建的全部 target
  frontend\                   # Vite 生产构建输出（不写回仓库 dist）
  temp\                       # 每次构建的会话 TEMP/TMP 目录

<外部私人归档>\               # 存放源码快照、迁移清单与恢复材料（不进入仓库）
```

本机具体路径记录在被忽略的 `.wgt-local.json` 与工作区外的私人说明文件中，不写入本仓库。

## 日常命令

```powershell
# 开发服务器（自动指向外部缓存根）
./scripts/dev-local.ps1

# 桌面发布构建（sidecar + AI 运行时资源 + tauri build）
./scripts/build-local.ps1

# 只编译不打包，快速验证
./scripts/build-local.ps1 -NoBundle

# 显式指定外部缓存根（覆盖 .wgt-local.json / 环境变量）
./scripts/build-local.ps1 -CacheRoot <外部缓存根>\wealth-growth-tracker
```

包装脚本的行为约定：

- 只修改**当前进程及子进程**的 `CARGO_TARGET_DIR` / `TEMP` / `TMP` /
  `WGT_CACHE_ROOT` / `WGT_FRONTEND_DIST`，退出时恢复原值
  （包括"原本未设置"的状态），不使用 `setx`，不影响其它项目。
- 拒绝把缓存根设为仓库根或仓库内部路径（那会造成反弹）。
- 拒绝已退役的 `D:\Dev` 与 `D:\DevCache` 及其任何子路径，不会自动回退或创建旧根。
- 直接运行 `npm run tauri:build` 仍会写回 `src-tauri/target`；发布的 CI 也保持默认输出，
  因此**本地请使用包装脚本**。

## 缓存保留策略

- 只保留一份活跃缓存（`cargo\`）。构建会话的 `temp\` 目录可以随时手工清理，
  脚本不会自动删除历史会话目录。
- 定期审计：`cargo\` 超过预留容量时，手工删除整个 `cargo\`（下一次构建重建）。
- 可再生清单（删除后用脚本/命令重建，不需要备份）：
  `src-tauri/target`、`src-tauri/binaries`（`node scripts/fetch-node-sidecar.mjs`）、
  `.ai-runtime-build`（`node scripts/prepare-ai-runtime-resources.mjs`）、
  `dist`（未注入 `WGT_FRONTEND_DIST` 时的 Web/CI 构建输出）、
  `.codex-visual`（视觉验证脚本重新生成）。
- **不可再生清单（必须保护）**：`.git`、未提交源码、`WealthGrowthTracker\`（在用程序）、
  私人归档（旧程序副本、迁移脚本、历史报告/Excel/备份）、AI 凭据所在系统密钥库。

## 审计 → 批准 → 执行

1. **Audit（只读）**：先用只读命令统计大小与归属，确认路径类型（junction/symlink/普通目录）
   与占用进程；不要仅凭目录名（例如 `tmp`）判断可删。
2. **Approve（人工）**：逐条列出 `源路径 / 类别 / 动作 / 目标 / 依据 / 验证方式`，
   经确认后才能执行。
3. **Apply（受控）**：复制/移动类操作先校验清单与哈希再删除源；删除可再生缓存时
   明确"通过重建恢复"。`.gitignore` 不是删除白名单，`git clean` 不属于本流程。

## CI 不受影响

GitHub Actions 仍然使用默认的 `src-tauri/target` 与 `release-assets` 路径，本仓库的
`build-local.ps1` 仅用于本机；修改 CI 产物路径需要同步修改 workflow 并重新验证，
本文件不代表授权。
