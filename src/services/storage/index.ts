import type { StorageAdapter } from './types';
import { BrowserStorageAdapter } from './browserAdapter';
import { LingguangStorageAdapter } from './lingguangAdapter';

/**
 * 存储服务 —— 业务层唯一的存储入口。
 *
 * - 灵光环境：检测到 window.lingguang.storage 时使用灵光适配器（兼容原 API / 原 key）。
 * - 普通浏览器：使用 localStorage。
 *
 * 提供带 JSON 序列化与容错的 getJSON / setJSON，读取到损坏数据时返回 null 而不抛出。
 */
class StorageService {
  private readonly adapter: StorageAdapter;

  constructor() {
    this.adapter =
      typeof window !== 'undefined' && window.lingguang?.storage
        ? new LingguangStorageAdapter()
        : new BrowserStorageAdapter();
  }

  getAdapterName(): StorageAdapter['name'] {
    return this.adapter.name;
  }

  async getRaw(key: string): Promise<string | null> {
    return this.adapter.getItem(key);
  }

  async setRaw(key: string, value: string): Promise<void> {
    await this.adapter.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.adapter.removeItem(key);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.adapter.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[storage] 键 "${key}" 的数据不是合法 JSON，已忽略:`, err);
      return null;
    }
  }

  async setJSON<T>(key: string, value: T): Promise<void> {
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      console.warn(`[storage] 键 "${key}" 序列化失败:`, err);
      return;
    }
    await this.adapter.setItem(key, raw);
  }
}

export const storageService = new StorageService();
export type { StorageAdapter };
