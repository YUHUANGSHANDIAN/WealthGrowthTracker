import type { StorageAdapter } from './types';

/**
 * 灵光环境适配器：在灵光小应用内检测到 window.lingguang.storage 时使用，
 * 复用原 API 与原始 key，从而在灵光环境内与旧版共享同一份数据。
 */
export class LingguangStorageAdapter implements StorageAdapter {
  readonly name = 'lingguang' as const;
  private readonly api: LingguangStorageApi | undefined;

  constructor() {
    this.api = typeof window !== 'undefined' ? window.lingguang?.storage : undefined;
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.api) return null;
    try {
      return (await this.api.getItem(key)) ?? null;
    } catch (err) {
      console.warn('[storage] 灵光读取失败:', err);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.setItem(key, value);
    } catch (err) {
      console.warn('[storage] 灵光写入失败:', err);
    }
  }

  async removeItem(key: string): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.removeItem(key);
    } catch (err) {
      console.warn('[storage] 灵光删除失败:', err);
    }
  }
}
