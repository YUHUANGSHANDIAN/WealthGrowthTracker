# HarmonyOS / OpenHarmony 支持状态（如实说明）

> 版本：v1.3.0 · 更新：2026-10-04

## 结论

- **Stable 原生 HAP：目前不提供。**
- **Web / PWA 兼容方案：提供**（HarmonyOS 兼容浏览器可安装 PWA 使用）。

Tauri 官方（`tauri` main / stable）截至本版本，尚未正式支持 HarmonyOS / OpenHarmony / OHOS 作为一等构建目标。

## 为什么不强行做原生 HAP

1. 为了一个实验性 HAP 而切换到 Tauri 实验分支，会破坏已稳定的 Windows / macOS / Linux / Android 构建。
2. 无法可靠生成原生 HAP 时，不伪造资产、不虚假宣传。

## 现状分层

| 轨道 | 状态 |
|------|------|
| 原生 HAP（Tauri 官方） | ❌ 未支持（等待官方 stable） |
| 原生 HAP（实验分支） | 🔬 独立轨道 `experimental/harmonyos`（若官方 `feat/open-harmony` 或其继任方案可 init/build/launch/storage，则产出 **Experimental HarmonyOS Preview**，绝不标 Stable） |
| Web / PWA 兼容 | ✅ 可安装 PWA（`dist/`，`base: './'`，离线外壳） |

## 未来迁移路径

1. 跟踪 Tauri 官方对 HarmonyOS / OpenHarmony 的支持进度。
2. 官方进入 stable 后，在同一 Frontend 上执行官方 `harmonyos` toolchain，产出原生 HAP。
3. 在此之前，HarmonyOS 用户使用 Web / PWA 兼容方案。

## 用户说明

- HarmonyOS 兼容浏览器可打开部署后的 Web 版本，并通过「添加到桌面」安装为 PWA。
- 数据存于浏览器 `localStorage`，不上传、不云同步。
