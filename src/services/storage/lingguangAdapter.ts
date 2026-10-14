import type { StorageAdapter } from './types';
import { StorageRecoveryError, StorageWriteError } from './desktop';

/**
 * 灵光环境适配器：在灵光小应用内检测到 window.lingguang.storage 时使用，
 * 复用原 API 与原始 key，从而在灵光环境内与旧版共享同一份数据。
 */
export class LingguangStorageAdapter implements StorageAdapter {
  readonly name = 'lingguang' as const;
  private readonly api: LingguangStorageApi | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.api = typeof window !== 'undefined' ? window.lingguang?.storage : undefined;
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.api) throw new StorageRecoveryError('unavailable', '灵光存储不可用');
    try {
      return (await this.api.getItem(key)) ?? null;
    } catch (err) {
      throw new StorageRecoveryError('permission', '灵光读取失败，禁止按新安装初始化', err);
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.setItems([{ key, value }]);
  }

  /**
   * 灵光 API 没有多键事务：全部写入经由单一队列串行执行，
   * 并在中途失败时尽量把已写入的键恢复为读取到的原值。
   */
  async setItems(entries: ReadonlyArray<{ key: string; value: string }>): Promise<void> {
    if (!this.api) throw new StorageWriteError('灵光存储不可用');
    if (!entries.length) return;
    const api = this.api;
    const write = this.queue.then(async () => {
      const previous: Array<{ key: string; value: string | null }> = [];
      for (const { key } of entries) {
        try {
          previous.push({ key, value: (await api.getItem(key)) ?? null });
        } catch (err) {
          throw new StorageRecoveryError('permission', '灵光读取失败，禁止覆盖未知旧值', err);
        }
      }
      const written: string[] = [];
      try {
        for (const { key, value } of entries) {
          await api.setItem(key, value);
          written.push(key);
        }
      } catch (err) {
        for (const key of written) {
          const prior = previous.find((entry) => entry.key === key);
          if (!prior) continue;
          try {
            if (prior.value === null) await api.removeItem(key);
            else await api.setItem(key, prior.value);
          } catch { /* 保留原始失败，回滚只是尽力而为 */ }
        }
        throw new StorageWriteError('灵光保存失败', err);
      }
    });
    this.queue = write.catch(() => {});
    return write;
  }

  async removeItem(key: string): Promise<void> {
    if (!this.api) throw new StorageWriteError('灵光存储不可用');
    const api = this.api;
    const remove = this.queue.then(async () => {
      try {
        await api.removeItem(key);
      } catch (err) {
        throw new StorageWriteError('灵光移除存储项失败', err);
      }
    });
    this.queue = remove.catch(() => {});
    return remove;
  }
}
