import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { BrowserStorageAdapter } from '../../src/services/storage/browserAdapter';
import { BROWSER_DATABASE, BROWSER_STATE_STORE, BROWSER_BACKUP_STORE, BROWSER_CANONICAL_KEY } from '../../src/services/storage/indexedDb';
import { STORAGE_KEYS } from '../../src/constants/storageKeys';
import { STORAGE_VERSION_KEY } from '../../src/constants/version';

let factory: IDBFactory;
let legacy: Storage;
beforeEach(() => {
  factory = new IDBFactory();
  const values = new Map<string, string>();
  legacy = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function adapter() { return new BrowserStorageAdapter({ indexedDB: factory, legacyStorage: legacy }); }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(BROWSER_DATABASE, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRecord(store: string, key: string): Promise<any> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const request = transaction.objectStore(store).get(key);
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

async function seed(value: unknown): Promise<void> {
  await adapter().getItem('missing');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(BROWSER_STATE_STORE, 'readwrite');
    transaction.objectStore(BROWSER_STATE_STORE).put(value, BROWSER_CANONICAL_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

describe('atomic browser persistence', () => {
  it('reads legacy keys without writing, then preserves them during the first atomic commit', async () => {
    const oldLedger = JSON.stringify({ channels: [], history: [] });
    legacy.setItem(STORAGE_KEYS.wealthTrackerData, oldLedger);
    legacy.setItem(STORAGE_VERSION_KEY, '1.6.1');
    legacy.setItem('unrelated-origin-key', 'must not be copied');
    const storage = adapter();
    expect(await storage.getItem(STORAGE_KEYS.wealthTrackerData)).toBe(oldLedger);
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toBeUndefined();

    await storage.setItems([
      { key: STORAGE_KEYS.wealthTrackerData, value: '{"channels":[],"history":[],"note":"new"}' },
      { key: STORAGE_VERSION_KEY, value: '1.7.0' },
    ]);
    const saved = await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY);
    expect(saved).toMatchObject({ storageSchemaVersion: 1, revision: 1, payload: { [STORAGE_VERSION_KEY]: '1.7.0' } });
    expect(saved.payload['unrelated-origin-key']).toBeUndefined();
    expect((await readRecord(BROWSER_BACKUP_STORE, 'legacy-localStorage')).payload[STORAGE_KEYS.wealthTrackerData]).toBe(oldLedger);
    expect(legacy.getItem(STORAGE_KEYS.wealthTrackerData)).toBe(oldLedger);
    expect(legacy.getItem(STORAGE_VERSION_KEY)).toBe('1.6.1');
  });

  it('commits multiple keys once and preserves the previous complete snapshot', async () => {
    const storage = adapter();
    await storage.setItems([{ key: 'ledger', value: 'old' }, { key: 'reports', value: 'old' }]);
    await storage.setItems([{ key: 'ledger', value: 'new' }, { key: 'reports', value: 'new' }]);
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toMatchObject({ revision: 2, payload: { ledger: 'new', reports: 'new' } });
    expect(await readRecord(BROWSER_BACKUP_STORE, 'previous')).toMatchObject({ revision: 1, payload: { ledger: 'old', reports: 'old' } });
    expect(await adapter().getItem('reports')).toBe('new');
  });

  it('rejects stale tabs without overwriting either ledger or reports', async () => {
    const first = adapter();
    const second = adapter();
    await Promise.all([first.getItem('ledger'), second.getItem('ledger')]);
    await first.setItems([{ key: 'ledger', value: 'first' }, { key: 'reports', value: 'first' }]);
    await expect(second.setItems([{ key: 'ledger', value: 'second' }, { key: 'reports', value: 'second' }])).rejects.toMatchObject({ name: 'StorageConflictError' });
    expect(await adapter().getItem('ledger')).toBe('first');
    expect(await adapter().getItem('reports')).toBe('first');
    await expect(second.setItem('ledger', 'retry-stale')).rejects.toMatchObject({ name: 'StorageConflictError' });
  });

  it('serializes simultaneous writes from one tab', async () => {
    const storage = adapter();
    await Promise.all([storage.setItem('a', '1'), storage.setItem('b', '2'), storage.setItem('c', '3')]);
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toMatchObject({ revision: 3, payload: { a: '1', b: '2', c: '3' } });
    await storage.removeItem('b');
    expect(await adapter().getItem('b')).toBeNull();
    expect(await storage.getItem('a')).toBe('1');
  });

  it('aborts both the backup and canonical update when storage fails, and can retry', async () => {
    const storage = adapter();
    await storage.setItems([{ key: 'ledger', value: 'old' }, { key: 'reports', value: 'old' }]);
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === BROWSER_STATE_STORE) throw new DOMException('full', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    });
    await expect(storage.setItems([{ key: 'ledger', value: 'new' }, { key: 'reports', value: 'new' }])).rejects.toThrow('保存失败');
    put.mockRestore();
    expect(await storage.getItem('ledger')).toBe('old');
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toMatchObject({ revision: 1, payload: { ledger: 'old', reports: 'old' } });
    expect(await readRecord(BROWSER_BACKUP_STORE, 'previous')).toBeUndefined();
    await storage.setItem('ledger', 'retry');
    expect(await adapter().getItem('ledger')).toBe('retry');
  });

  it('preserves unknown envelope and payload fields', async () => {
    await seed({ storageSchemaVersion: 1, revision: 7, customMetadata: { retained: true }, payload: { custom_key: 'original', ledger: 'old' } });
    await adapter().setItem('ledger', 'new');
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toMatchObject({ revision: 8, customMetadata: { retained: true }, payload: { custom_key: 'original', ledger: 'new' } });
  });

  it.each([
    [{ storageSchemaVersion: 2, revision: 1, payload: {} }, 'future-schema'],
    [{ storageSchemaVersion: 1, revision: -1, payload: {} }, 'invalid-state'],
    [{ storageSchemaVersion: 1, revision: 1, payload: { ledger: 0 } }, 'invalid-state'],
  ])('refuses corrupt and future snapshots without writing: %j', async (value, reason) => {
    await seed(value);
    const storage = adapter();
    await expect(storage.getItem('ledger')).rejects.toMatchObject({ reason });
    await expect(storage.setItem('ledger', 'empty')).rejects.toMatchObject({ reason });
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toEqual(value);
  });

  it('unavailable storage is not treated as an empty installation', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const adapter = new BrowserStorageAdapter();
    await expect(adapter.getItem('ledger')).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(adapter.setItem('ledger', '{}')).rejects.toThrow('不可用');
    await expect(adapter.removeItem('ledger')).rejects.toThrow('不可用');
  });

  it('legacy read failures throw instead of initializing empty data', async () => {
    vi.spyOn(legacy, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    await expect(adapter().getItem('ledger')).rejects.toMatchObject({ reason: 'permission' });
    expect(await readRecord(BROWSER_STATE_STORE, BROWSER_CANONICAL_KEY)).toBeUndefined();
  });

  it('an existing canonical snapshot does not depend on legacy storage access', async () => {
    await adapter().setItem('ledger', 'retained');
    const storage = new BrowserStorageAdapter({ indexedDB: factory, legacyStorage: null });
    expect(await storage.getItem('ledger')).toBe('retained');
    await storage.setItem('ledger', 'updated');
    expect(await adapter().getItem('ledger')).toBe('updated');
  });
});
