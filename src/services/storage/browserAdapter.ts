import type { StorageAdapter } from './types';

/** 安全访问 localStorage：隐私模式/被禁用时返回 null，不抛异常。 */
function detectLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__wealth_tracker_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 浏览器默认适配器：localStorage。
 *
 * 选型理由：个人资产数据规模很小（渠道数十个、历史一天一条、报告若干份），
 * 总量远低于 localStorage 5MB 上限，且同步读写简单可靠。接口保留为 Promise，
 * 与灵光/未来 IndexedDB 适配器一致；若历史记录未来大幅增长，可在此处替换为 IndexedDB。
 */
export class BrowserStorageAdapter implements StorageAdapter {
  readonly name = 'browser' as const;
  private readonly storage: Storage | null;

  constructor() {
    this.storage = detectLocalStorage();
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.storage) return;
    try {
      this.storage.setItem(key, value);
    } catch (err) {
      console.warn('[storage] 写入失败（可能超出容量）:', err);
    }
  }

  async removeItem(key: string): Promise<void> {
    if (!this.storage) return;
    try {
      this.storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
