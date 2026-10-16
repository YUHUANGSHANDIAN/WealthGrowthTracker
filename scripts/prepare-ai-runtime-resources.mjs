#!/usr/bin/env node
/**
 * Copy ai-runtime/ (including its node_modules) into a build directory that the
 * Tauri desktop bundles ship as resources:
 *   .ai-runtime-build/resources  ->  <app resources>/ai-runtime
 *
 * Symlinks are dereferenced so the copy is portable, and the script only ever
 * touches the dedicated `.ai-runtime-build` directory it owns.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "ai-runtime");
const buildRoot = join(repoRoot, ".ai-runtime-build");
const destination = join(buildRoot, "resources");

const EXCLUDED = new Set(["test", "node_modules/.cache", "AUDIT.md"]);

/**
 * koffi 随包提供同一平台的 glibc 与 musl 两套预编译件。桌面目标（Windows/macOS/glibc Linux）
 * 只会加载 glibc 那套，而 musl 版 ELF 的解释器是 libc.musl-x86_64.so.1，在构建机上并不存在——
 * linuxdeploy 扫描 AppDir 里每个 ELF 的依赖时会因此直接失败（AppImage 一直产不出来的真实原因）。
 * 只删 musl 变体，glibc 变体原样保留。
 */
function pruneMuslPrebuilts(root) {
  const scope = join(root, "node_modules", "@koromix");
  if (!existsSync(scope)) return 0;
  let removed = 0;
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = join(scope, entry.name);
    for (const variant of readdirSync(packageRoot, { withFileTypes: true })) {
      if (!variant.isDirectory() || !variant.name.startsWith("musl_")) continue;
      rmSync(join(packageRoot, variant.name), { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

function guard() {
  if (!buildRoot.startsWith(repoRoot) || !buildRoot.endsWith(".ai-runtime-build")) {
    throw new Error("拒绝操作：构建目录不在仓库内");
  }
}

function copyTree(from, to, relative = "") {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (EXCLUDED.has(rel)) continue;
    const sourcePath = join(from, entry.name);
    const targetPath = join(to, entry.name);
    if (entry.isSymbolicLink()) {
      // 解引用：把链接指向的真实内容复制过去，保持跨平台可打包。
      cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    } else if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath, rel);
    } else {
      cpSync(sourcePath, targetPath);
    }
  }
}

guard();
if (!existsSync(join(source, "main.mjs"))) throw new Error("ai-runtime/main.mjs 不存在");
if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
copyTree(source, destination);
const prunedVariants = pruneMuslPrebuilts(destination);

const stamp = {
  preparedAt: new Date().toISOString(),
  nodeVersion: process.env.WGT_NODE_VERSION ?? "24.21.0",
  lock: JSON.parse(readFileSync(join(source, "package-lock.json"), "utf8")).lockfileVersion,
  prunedMuslVariants: prunedVariants,
};
writeFileSync(join(buildRoot, "stamp.json"), JSON.stringify(stamp, null, 2));
if (!existsSync(join(destination, "providers", "pi.mjs"))) throw new Error("资源复制不完整：缺少 providers/pi.mjs");
console.log(`✓ ai-runtime 资源已准备（解引用符号链接，清理 ${prunedVariants} 个 musl 变体）：${destination}`);
