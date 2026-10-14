#!/usr/bin/env node
/**
 * Download the pinned Node runtime and place it where Tauri expects the sidecar:
 *   src-tauri/binaries/node-<target-triple>[.exe]
 *
 * Usage:
 *   node scripts/fetch-node-sidecar.mjs                 # host platform triple
 *   node scripts/fetch-node-sidecar.mjs --target aarch64-apple-darwin --target x86_64-apple-darwin
 *   node scripts/fetch-node-sidecar.mjs --universal-darwin   # lipo both macOS slices
 *
 * Everything is verified against the official SHASUMS256.txt of the pinned release.
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NODE_VERSION = process.env.WGT_NODE_VERSION ?? "24.21.0";
const DIST = `https://nodejs.org/dist/v${NODE_VERSION}`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const isWindows = process.platform === "win32";

const ARTIFACTS = {
  "x86_64-pc-windows-msvc": { file: `node-v${NODE_VERSION}-win-x64.zip`, binary: "node.exe" },
  "aarch64-pc-windows-msvc": { file: `node-v${NODE_VERSION}-win-arm64.zip`, binary: "node.exe" },
  "aarch64-apple-darwin": { file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, binary: "node" },
  "x86_64-apple-darwin": { file: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, binary: "node" },
  "x86_64-unknown-linux-gnu": { file: `node-v${NODE_VERSION}-linux-x64.tar.gz`, binary: "node" },
  "aarch64-unknown-linux-gnu": { file: `node-v${NODE_VERSION}-linux-arm64.tar.gz`, binary: "node" },
};

function hostTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const universalDarwin = argv.includes("--universal-darwin");
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--target" && argv[index + 1]) { targets.push(argv[index + 1]); index += 1; }
    else if (argv[index] === "--all-desktop") targets.push("x86_64-pc-windows-msvc", "aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-unknown-linux-gnu");
  }
  if (!targets.length && !universalDarwin) targets.push(hostTriple());
  return { universalDarwin, targets };
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`下载失败 ${url}: HTTP ${response.status}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  const { universalDarwin, targets: requestedTargets } = parseArgs();
  const targets = universalDarwin ? ["aarch64-apple-darwin", "x86_64-apple-darwin"] : requestedTargets;
  if (universalDarwin && process.platform !== "darwin") {
    throw new Error("--universal-darwin 只能在 macOS 上运行（需要 lipo）");
  }
  for (const target of targets) {
    if (!ARTIFACTS[target]) throw new Error(`不支持的 target：${target}`);
  }
  mkdirSync(binariesDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "wgt-node-sidecar-"));
  const checksumsFile = join(scratch, "SHASUMS256.txt");
  await download(`${DIST}/SHASUMS256.txt`, checksumsFile);
  const checksums = new Map(readFileSync(checksumsFile, "utf8").split("\n").filter(Boolean).map((line) => {
    const [hash, name] = line.trim().split(/\s+/);
    return [name, hash];
  }));
  try {
    const extractedBinaries = new Map();
    for (const target of targets) {
      const { file, binary } = ARTIFACTS[target];
      const archive = join(scratch, file);
      console.log(`↓ ${NODE_VERSION} ${file}`);
      await download(`${DIST}/${file}`, archive);
      const expected = checksums.get(file);
      const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
      if (!expected || expected !== actual) throw new Error(`${file} 校验失败：期望 ${expected ?? "(缺失)"}，实际 ${actual}`);
      const extracted = join(scratch, `extract-${target}`);
      mkdirSync(extracted, { recursive: true });
      // Windows 10+/macOS/Linux 自带 bsdtar，可同时处理 .zip 与 .tar.gz。
      execFileSync(isWindows ? "tar.exe" : "tar", ["-xf", archive, "-C", extracted], { stdio: ["ignore", "ignore", "inherit"] });
      const entries = execFileSync("node", ["-e", `console.log(require("fs").readdirSync(${JSON.stringify(extracted)}).join("\\n"))`], { encoding: "utf8" }).trim().split("\n");
      const folder = join(extracted, entries[0]);
      const source = join(folder, "bin", binary);
      const resolvedSource = existsSync(source) ? source : join(folder, binary);
      if (!existsSync(resolvedSource)) throw new Error(`压缩包内未找到 ${binary}`);
      if (universalDarwin) {
        extractedBinaries.set(target, resolvedSource);
        console.log(`✓ ${target} 已下载（待合并为 universal）`);
        continue;
      }
      const destination = join(binariesDir, `node-${target}${binary.endsWith(".exe") ? ".exe" : ""}`);
      copyFileSync(resolvedSource, destination);
      if (!destination.endsWith(".exe")) chmodSync(destination, 0o755);
      console.log(`✓ ${basename(destination)}（sha256 ${actual.slice(0, 16)}…）`);
    }
    if (universalDarwin) {
      // 通用（universal）构建分阶段执行：每个架构的 cargo 构建需要各自的
      // sidecar，最终打包阶段需要 lipo 合并后的 universal 产物，因此三者都要。
      for (const [target, source] of extractedBinaries) {
        const perArch = join(binariesDir, `node-${target}`);
        copyFileSync(source, perArch);
        chmodSync(perArch, 0o755);
      }
      const destination = join(binariesDir, "node-universal-apple-darwin");
      execFileSync("lipo", [
        "-create",
        extractedBinaries.get("aarch64-apple-darwin"),
        extractedBinaries.get("x86_64-apple-darwin"),
        "-output", destination,
      ], { stdio: ["ignore", "ignore", "inherit"] });
      chmodSync(destination, 0o755);
      console.log("✓ node-aarch64-apple-darwin / node-x86_64-apple-darwin / node-universal-apple-darwin");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`fetch-node-sidecar 失败：${error.message}`);
  process.exitCode = 1;
});
