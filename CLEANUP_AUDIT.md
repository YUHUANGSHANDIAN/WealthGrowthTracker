# 本地项目目录清理审计（CLEANUP_AUDIT）

> 清理日期：2026-10-04 · 版本：v1.4.0 已发布验证通过
> 项目目录：本机开发工作区（具体路径不写入仓库，见 `docs/WORKSPACE_HYGIENE.md`）

## 清理前大小

- 项目目录总计：约 **203 MB**
  - `node_modules/`：177 MB（依赖，`npm ci` 可恢复）
  - `src-tauri/target/`：11 MB（Rust 构建缓存，`cargo build` 可恢复）
  - `.git/`：2.6 MB（Git 历史，保留）
  - `dist/`：1.1 MB（前端构建产物，`npm run build` 可恢复）
  - `WealthGrowthTracker/`：约 3.3 MB（旧 v1.2 Windows 安装器本地副本，非 tracked）
  - `public/`：173 KB（PWA 图标/清单，源码，保留）

## 文件分类

| 类别 | 处理 | 说明 |
|---|---|---|
| Git 源码（.git, src, src-tauri, public, docs, .github, tests, assets, package*.json, Cargo.*, README, CHANGELOG, 配置） | ✅ 保留 | 不可再生源码 |
| `dist/` | 🗑 删除 | `npm run build` 可恢复 |
| `src-tauri/target/` | 🗑 删除 | `cargo build` 可恢复 |
| `WealthGrowthTracker/`（旧安装器 exe/uninstall） | ➡️ 移动 `local-archives/` | 冗余本地安装器副本，非 tracked，GitHub Release 已有正式产物 |
| `tsconfig.tsbuildinfo` | 🗑 删除 | TypeScript 增量缓存，可恢复 |
| `node_modules/` | ✅ 保留 | 默认保留当前开发环境（spec 140） |
| `财富梦想实现家.html` + `_files/` | ✅ 保留 | 灵光旧版 production bundle，历史参考，明确不删除 |
| 用户旧版彩票工作簿 | ✅ 保留（不在本目录） | 属于私人数据，绝不删除，也不写入公开记录 |
| Secrets（.env / keystore / 签名） | ✅ 保留 | 无此类文件存在于本目录 |

## 清理动作（执行）

1. 删除 `dist/`
2. 删除 `src-tauri/target/`
3. 移动 `WealthGrowthTracker/` → `local-archives/`（gitignore）
4. 删除 `tsconfig.tsbuildinfo`
5. `.gitignore` 增加 `local-archives/`、`local-imports/`

## 清理后大小

- 项目目录总计：约 **191 MB**（减少约 12 MB）
  - `node_modules/`：177 MB（保留）
  - 已删除：`dist/`（1.1 MB）、`src-tauri/target/`（11 MB）、`tsconfig.tsbuildinfo`
  - 已移动：`WealthGrowthTracker/` → `local-archives/`（旧安装器副本，未删除）

## 清理后验证

- `git status`：仅 `.gitignore` 修改 + `CLEANUP_AUDIT.md` 新增，无 tracked 文件被误删（212 个 tracked 文件完整）。
- `npm run typecheck`：通过，源码完整（node_modules 保留）。

## 明确不删除

- 用户 Excel 原始资料（父目录，未进入 Git）。
- 用户数据、备份、Secrets、Git 历史。
- 任何 `.env` / keystore / 签名凭据。
