import type { StorageAdapter } from './types';
import { BrowserStorageAdapter } from './browserAdapter';
import { LingguangStorageAdapter } from './lingguangAdapter';
import { DesktopFileStorageAdapter, DesktopDataManager, StorageRecoveryError, StorageWriteError } from './desktop';
import { isTauri, createTauriFileSystem, type FileSystem } from './fs';

/** 惰性初始化 Tauri 文件系统（避免 Web 构建加载 Tauri 代码）。 */
function lazyTauriFs(): FileSystem {
  let promise: Promise<FileSystem> | null = null;
  const get = () => (promise ??= createTauriFileSystem());
  return {
    readTextFile: (p) => get().then((f) => f.readTextFile(p)),
    writeTextFile: (p, c) => get().then((f) => f.writeTextFile(p, c)),
    exists: (p) => get().then((f) => f.exists(p)),
    mkdir: (p) => get().then((f) => f.mkdir(p)),
    readDir: (p) => get().then((f) => f.readDir(p)),
    removeFile: (p) => get().then((f) => f.removeFile(p)),
    copyFile: (s, d) => get().then((f) => f.copyFile(s, d)),
    rename: (s, d) => get().then((f) => f.rename(s, d)),
  };
}

/**
 * 存储服务 —— 业务层唯一的存储入口。
 * 优先级：Tauri 桌面（文件）> 灵光运行时 > 浏览器 IndexedDB。
 */
class StorageService {
  private readonly adapter: StorageAdapter;
  private drainHooks = new Set<() => Promise<void>>();
  private writesPaused = false;

  constructor() {
    if (isTauri()) {
      this.adapter = new DesktopFileStorageAdapter(lazyTauriFs());
    } else if (typeof window !== 'undefined' && window.lingguang?.storage) {
      this.adapter = new LingguangStorageAdapter();
    } else {
      this.adapter = new BrowserStorageAdapter();
    }
  }

  getAdapterName(): StorageAdapter['name'] {
    return this.adapter.name;
  }

  /** 桌面模式下暴露数据目录管理器（备份/恢复/报告）。 */
  getDesktopManager(): DesktopDataManager | null {
    return this.adapter instanceof DesktopFileStorageAdapter ? this.adapter.manager : null;
  }

  async getRaw(key: string): Promise<string | null> {
    return this.adapter.getItem(key);
  }

  async setRaw(key: string, value: string): Promise<void> {
    if (this.writesPaused) throw new Error('存储正在迁移，暂时不能写入');
    await this.adapter.setItem(key, value);
  }

  async setBatch(entries: ReadonlyArray<{ key: string; value: string }>): Promise<void> {
    if (this.writesPaused) throw new Error('存储正在迁移，暂时不能写入');
    if (this.adapter.setItems) await this.adapter.setItems(entries);
    else for (const { key, value } of entries) await this.adapter.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    if (this.writesPaused) throw new Error('存储正在迁移，暂时不能写入');
    await this.adapter.removeItem(key);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.adapter.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new StorageRecoveryError('corrupt', `存储键 ${key} 不是合法 JSON`, err);
    }
  }

  async setJSON<T>(key: string, value: T): Promise<void> {
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      throw new StorageWriteError(`存储键 ${key} 序列化失败`, err);
    }
    await this.setRaw(key, raw);
  }

  /** 立即持久化（桌面模式下把缓存落盘，应用退出前调用）。 */
  async flush(): Promise<void> {
    for (const drain of this.drainHooks) await drain();
    await this.flushAdapter();
  }

  async flushAdapter(): Promise<void> {
    if (this.adapter instanceof DesktopFileStorageAdapter) {
      await this.adapter.drain();
    }
  }

  registerDrainHook(hook: () => Promise<void>): () => void {
    this.drainHooks.add(hook);
    return () => this.drainHooks.delete(hook);
  }

  pauseWrites(): void {
    this.writesPaused = true;
    if (this.adapter instanceof DesktopFileStorageAdapter) this.adapter.pauseWrites();
  }

  resumeWrites(): void {
    if (this.adapter instanceof DesktopFileStorageAdapter) this.adapter.resumeWrites();
    this.writesPaused = false;
  }

  /** 从文件重新加载缓存（桌面模式「从备份恢复」后调用）。 */
  async reload(): Promise<void> {
    if (this.adapter instanceof DesktopFileStorageAdapter) {
      await this.adapter.reload();
    }
  }
}

export const storageService = new StorageService();
export { isTauri, openPathInSystem, getDocumentsDir, getDefaultDataDir } from './fs';
export { DesktopFileStorageAdapter, DesktopDataManager, DATA_FOLDER } from './desktop';
export { StorageRecoveryError, StorageWriteError } from './desktop';
export type { StorageAdapter };
