import type { StorageAdapter } from './types';
import { APP_VERSION, STORAGE_VERSION_KEY } from '../../constants/version';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { StorageRecoveryError, StorageWriteError } from './desktop';

export const BROWSER_DATABASE = 'wealth-growth-tracker';
export const BROWSER_STATE_STORE = 'state';
export const BROWSER_BACKUP_STORE = 'backups';
export const BROWSER_CANONICAL_KEY = 'canonical';

interface BrowserEnvelope {
  storageSchemaVersion: 1;
  appVersion: string;
  revision: number;
  updatedAt: string;
  payload: Record<string, string>;
  [key: string]: unknown;
}

export class StorageConflictError extends StorageWriteError {
  constructor() {
    super('其他标签页已保存新数据。请先导出未保存内容，再重新加载以解决冲突');
    this.name = 'StorageConflictError';
  }
}

function parseEnvelope(value: unknown): BrowserEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageRecoveryError('invalid-state', '浏览器数据快照结构无效');
  }
  const envelope = value as Record<string, unknown>;
  if (typeof envelope.storageSchemaVersion === 'number' && envelope.storageSchemaVersion > 1) {
    throw new StorageRecoveryError('future-schema', '浏览器数据来自更新版本，当前版本禁止写入');
  }
  if (envelope.storageSchemaVersion !== 1 || !Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 0 ||
    !envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload) ||
    Object.values(envelope.payload).some(item => typeof item !== 'string')) {
    throw new StorageRecoveryError('invalid-state', '浏览器数据快照结构无效');
  }
  return envelope as BrowserEnvelope;
}

/**
 * One immutable snapshot per tab. A readwrite IndexedDB transaction checks the
 * observed revision and commits all storage keys, plus the previous snapshot,
 * together. A stale tab never silently overwrites a newer financial ledger.
 * Legacy localStorage is read only when there is no IndexedDB snapshot, and is
 * retained intact. No persistent-store failure falls back to empty data.
 */
export class BrowserStorageAdapter implements StorageAdapter {
  readonly name = 'browser' as const;
  private database: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private envelope: BrowserEnvelope | null = null;
  private cache: Record<string, string> = {};
  private legacySnapshot: Record<string, string> | null = null;

  constructor(private readonly options: {
    indexedDB?: IDBFactory;
    legacyStorage?: Storage | null;
    databaseName?: string;
  } = {}) {}

  private ensureInit(): Promise<void> {
    return this.initPromise ??= this.load().catch(error => {
      if (error instanceof StorageRecoveryError) throw error;
      throw new StorageRecoveryError('unavailable', '浏览器持久存储不可用，请检查存储权限', error);
    });
  }

  private async load(): Promise<void> {
    let factory: IDBFactory | undefined;
    try { factory = this.options.indexedDB ?? globalThis.indexedDB; }
    catch (cause) { throw new StorageRecoveryError('unavailable', '浏览器持久存储不可用', cause); }
    if (!factory) throw new StorageRecoveryError('unavailable', '浏览器持久存储不可用，请检查存储权限');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = factory.open(this.options.databaseName ?? BROWSER_DATABASE, 1);
      request.onupgradeneeded = () => {
        for (const name of [BROWSER_STATE_STORE, BROWSER_BACKUP_STORE]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
      request.onerror = () => reject(new StorageRecoveryError(
        request.error?.name === 'VersionError' ? 'future-schema' : 'unavailable',
        '无法打开浏览器持久存储，请检查权限或应用版本', request.error,
      ));
      request.onblocked = () => {
        blocked = true;
        reject(new StorageRecoveryError('unavailable', '存储升级被其他标签页阻止，请关闭旧版本标签页'));
      };
    });
    this.database = database;
    database.onversionchange = () => database.close();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(BROWSER_STATE_STORE, 'readonly');
      const request = transaction.objectStore(BROWSER_STATE_STORE).get(BROWSER_CANONICAL_KEY);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new StorageRecoveryError('permission', '无法读取浏览器数据快照', transaction.error));
    });
    if (stored !== undefined) {
      this.envelope = parseEnvelope(stored);
      this.cache = { ...this.envelope.payload };
      return;
    }
    // Do not create a version-only snapshot during first-run initialization.
    // Legacy data is copied only by the first successful atomic business write.
    let legacy: Storage | null;
    try { legacy = 'legacyStorage' in this.options ? this.options.legacyStorage ?? null : globalThis.localStorage; }
    catch (cause) { throw new StorageRecoveryError('permission', '无法读取旧版浏览器存储，禁止初始化空数据', cause); }
    if (!legacy) throw new StorageRecoveryError('unavailable', '无法确认旧版浏览器数据，请检查存储权限');
    try {
      const payload: Record<string, string> = {};
      for (const key of [...Object.values(STORAGE_KEYS), STORAGE_VERSION_KEY]) {
        const value = legacy.getItem(key);
        if (value !== null) payload[key] = value;
      }
      this.cache = payload;
      this.legacySnapshot = Object.keys(payload).length ? { ...payload } : null;
    } catch (cause) {
      throw new StorageRecoveryError('permission', '无法读取旧版浏览器存储，禁止初始化空数据', cause);
    }
  }

  async getItem(key: string): Promise<string | null> {
    await this.ensureInit();
    await this.writeQueue;
    return this.cache[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.setItems([{ key, value }]);
  }

  async setItems(entries: ReadonlyArray<{ key: string; value: string }>): Promise<void> {
    if (!entries.length) return;
    const changes = entries.map(({ key, value }) => ({ key, value }));
    return this.enqueue(payload => {
      for (const { key, value } of changes) payload[key] = value;
    });
  }

  async removeItem(key: string): Promise<void> {
    return this.enqueue(payload => { delete payload[key]; });
  }

  private async enqueue(change: (payload: Record<string, string>) => void): Promise<void> {
    await this.ensureInit();
    const write = this.writeQueue.then(async () => {
      const payload = { ...this.cache };
      change(payload);
      await this.commit(payload);
    });
    this.writeQueue = write.catch(() => {});
    return write;
  }

  private async commit(payload: Record<string, string>): Promise<void> {
    const database = this.database;
    if (!database) throw new StorageWriteError('浏览器持久存储不可用');
    const expectedRevision = this.envelope?.revision ?? 0;
    if (expectedRevision === Number.MAX_SAFE_INTEGER) throw new StorageWriteError('存储版本号已达上限，禁止继续写入');
    let failure: unknown;
    let next: BrowserEnvelope | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([BROWSER_STATE_STORE, BROWSER_BACKUP_STORE], 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(failure ?? new StorageWriteError('浏览器保存失败，请检查容量与存储权限', transaction.error));
        const state = transaction.objectStore(BROWSER_STATE_STORE);
        const request = state.get(BROWSER_CANONICAL_KEY);
        request.onsuccess = () => {
          try {
            const current = request.result === undefined ? null : parseEnvelope(request.result);
            if ((current?.revision ?? 0) !== expectedRevision || (current === null) !== (this.envelope === null)) {
              throw new StorageConflictError();
            }
            const backups = transaction.objectStore(BROWSER_BACKUP_STORE);
            if (current) backups.put(current, 'previous');
            if (this.legacySnapshot) backups.put({ payload: this.legacySnapshot, preservedAt: new Date().toISOString() }, 'legacy-localStorage');
            next = {
              ...current,
              storageSchemaVersion: 1,
              appVersion: APP_VERSION,
              revision: expectedRevision + 1,
              updatedAt: new Date().toISOString(),
              payload,
            };
            state.put(next, BROWSER_CANONICAL_KEY);
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
      });
    } catch (error) {
      if (error instanceof StorageWriteError || error instanceof StorageRecoveryError) throw error;
      throw new StorageWriteError('浏览器保存失败，请检查容量与存储权限', error);
    }
    this.envelope = next;
    this.cache = payload;
    this.legacySnapshot = null;
  }
}
