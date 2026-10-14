/**
 * 文件系统抽象层：把「相对 Documents 目录的路径」映射到真实文件系统。
 * - Tauri 环境：通过自定义 Rust 命令（invoke）读写，根目录为 `<Documents>/财富成长记`。
 * - 测试环境：注入内存/临时目录实现。
 * 桌面存储逻辑因此可在纯 Node/Vitest 中单测，而 Web 版不加载任何 Tauri 代码。
 */

export interface FileSystem {
  readTextFile(relPath: string): Promise<string>;
  writeTextFile(relPath: string, content: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  mkdir(relPath: string): Promise<void>;
  readDir(relPath: string): Promise<string[]>;
  removeFile(relPath: string): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  rename(src: string, dst: string): Promise<void>;
}

/** 是否运行在 Tauri 桌面环境。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 创建 Tauri 文件系统实现（通过自定义 Rust 命令，仅在 Tauri 环境调用）。 */
export async function createTauriFileSystem(): Promise<FileSystem> {
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    readTextFile: (p) => invoke<string>('fs_read_text', { relPath: p }),
    writeTextFile: (p, c) => invoke<void>('fs_write_text', { relPath: p, content: c }),
    exists: (p) => invoke<boolean>('fs_exists', { relPath: p }),
    mkdir: (p) => invoke<void>('fs_mkdir', { relPath: p }),
    readDir: (p) => invoke<string[]>('fs_read_dir', { relPath: p }),
    removeFile: (p) => invoke<void>('fs_remove', { relPath: p }),
    copyFile: (s, d) => invoke<void>('fs_copy', { src: s, dst: d }),
    rename: (s, d) => invoke<void>('fs_rename', { src: s, dst: d }),
  };
}

/** 获取用户 Documents 目录绝对路径（仅 Tauri）。 */
export async function getDocumentsDir(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('document_dir');
}

/** 默认数据根目录（忽略自定义配置，用于「恢复默认位置」）。 */
export async function getDefaultDataDir(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('default_data_dir');
}

/** 数据根目录配置（与 Rust storage-config.json 对应）。 */
export interface DataRootConfig {
  dataRootMode: 'default' | 'custom';
  customDataRoot?: string;
  updatedAt?: string;
}

/** 读取数据根目录配置（仅 Tauri，返回 null 表示非 Tauri 环境）。 */
export async function readStorageConfig(): Promise<DataRootConfig | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DataRootConfig>('storage_config_read');
}

/** 写入数据根目录配置（仅 Tauri）。 */
export async function writeStorageConfig(config: DataRootConfig): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<void>('storage_config_write', { config });
}

/** 获取 OS App Config Directory 路径（仅 Tauri）。 */
export async function getConfigDir(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('config_dir');
}

/** Read-only configuration inspection does not resolve paths through the damaged config. */
export interface ConfigRecoveryStatus {
  exists: boolean;
  damaged: boolean;
  detail: string | null;
}

export interface RecoveryRootInspection {
  canonicalRoot: string;
  hasPrimaryState: boolean;
  backups: string[];
}

export interface ConfigRepairResult {
  canonicalRoot: string;
  preservedConfig: string;
  preservedState: string | null;
  durabilityWarning: string | null;
}

export async function inspectStorageConfigRecovery(): Promise<ConfigRecoveryStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ConfigRecoveryStatus>('storage_config_recovery_status');
}

export async function inspectRecoveryRoot(root: string): Promise<RecoveryRootInspection> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<RecoveryRootInspection>('storage_recovery_inspect_root', { root });
}

export async function readRecoveryCandidate(root: string, candidate: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('storage_recovery_read_candidate', { root, candidate });
}

/** Explicit confirmation only. Backend preserves original bytes and rechecks the preview. */
export async function repairStorageConfigFromCandidate(
  root: string, candidate: string, expectedRaw: string,
): Promise<ConfigRepairResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ConfigRepairResult>('storage_config_recovery_repair', { root, candidate, expectedRaw });
}

/** 把整个数据根目录从 src 复制到 dst（跨磁盘安全），返回复制的文件数。 */
export async function migrateDataRoot(src: string, dst: string): Promise<number> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number>('migrate_data_root', { src, dst });
}

/** 原生打开一个路径（目录用资源管理器，文件用默认程序）。 */
export async function openPathInSystem(relPath: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<void>('open_path', { relPath });
}
