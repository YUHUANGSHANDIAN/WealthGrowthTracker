import { afterEach, describe, expect, it, vi } from 'vitest';
import { LingguangStorageAdapter } from '../../src/services/storage/lingguangAdapter';

afterEach(() => { delete window.lingguang; vi.restoreAllMocks(); });

describe('Lingguang storage errors', () => {
  it('refuses missing storage instead of pretending to save', async () => {
    delete window.lingguang;
    const storage = new LingguangStorageAdapter();
    await expect(storage.getItem('ledger')).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(storage.setItem('ledger', 'new')).rejects.toThrow('不可用');
    await expect(storage.removeItem('ledger')).rejects.toThrow('不可用');
  });
  it('propagates all read and write failures', async () => {
    window.lingguang = { storage: {
      getItem: vi.fn().mockRejectedValue(new Error('denied')),
      setItem: vi.fn().mockRejectedValue(new Error('denied')),
      removeItem: vi.fn().mockRejectedValue(new Error('denied')),
    } };
    const storage = new LingguangStorageAdapter();
    await expect(storage.getItem('ledger')).rejects.toMatchObject({ reason: 'permission' });
    // Writes re-read the previous value first so a failed batch can be rolled back.
    await expect(storage.setItem('ledger', 'new')).rejects.toMatchObject({ reason: 'permission' });
    await expect(storage.removeItem('ledger')).rejects.toThrow('失败');
  });
  it('writes batches through a single ordered queue', async () => {
    const calls: string[] = [];
    window.lingguang = { storage: {
      getItem: vi.fn(async (key: string) => { calls.push(`get:${key}`); return null; }),
      setItem: vi.fn(async (key: string) => { await Promise.resolve(); calls.push(`set:${key}`); }),
      removeItem: vi.fn(async (key: string) => { calls.push(`remove:${key}`); }),
    } };
    const storage = new LingguangStorageAdapter();
    await Promise.all([
      storage.setItems([{ key: 'a', value: '1' }, { key: 'b', value: '2' }]),
      storage.setItem('c', '3'),
    ]);
    expect(calls).toEqual(['get:a', 'get:b', 'set:a', 'set:b', 'get:c', 'set:c']);
  });
  it('restores already written keys when a batch fails midway', async () => {
    const setItem = vi.fn(async (key: string, value: string) => {
      if (key === 'b' && value === '2') throw new Error('denied');
    });
    window.lingguang = { storage: {
      getItem: vi.fn(async (key: string) => (key === 'a' ? 'old-a' : null)),
      setItem,
      removeItem: vi.fn(async () => {}),
    } };
    const storage = new LingguangStorageAdapter();
    await expect(storage.setItems([{ key: 'a', value: '1' }, { key: 'b', value: '2' }])).rejects.toThrow('保存失败');
    expect(setItem).toHaveBeenCalledWith('a', '1');
    expect(setItem).toHaveBeenCalledWith('a', 'old-a');
  });
  it('refuses to write when the prior value cannot be read for rollback', async () => {
    window.lingguang = { storage: {
      getItem: vi.fn().mockRejectedValue(new Error('denied')),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    } };
    const storage = new LingguangStorageAdapter();
    await expect(storage.setItem('ledger', 'new')).rejects.toMatchObject({ reason: 'permission' });
  });
});
