import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { storageService } from '../../src/services/storage';
import { STORAGE_KEYS } from '../../src/constants/storageKeys';
import { APP_VERSION } from '../../src/constants/version';

afterEach(()=>{vi.restoreAllMocks();storageService.resumeWrites();});
describe('hydrate recovery boundary',()=>{
  it('concurrent hydrate shares one load and can retry after rejection', async () => {
    const reads = vi.spyOn(storageService, 'getJSON').mockRejectedValue(new Error('unavailable'));
    const first = useAppStore.getState().hydrate();
    const second = useAppStore.getState().hydrate();
    expect(first).toBe(second);
    await expect(first).rejects.toThrow('unavailable');
    const count = reads.mock.calls.length;
    await expect(useAppStore.getState().hydrate()).rejects.toThrow('unavailable');
    expect(reads.mock.calls.length).toBe(count * 2);
  });
  it('missing ledger in an existing installation does not initialize defaults', async () => {
    vi.spyOn(storageService, 'getJSON').mockResolvedValue(null);
    vi.spyOn(storageService, 'getRaw').mockResolvedValue(APP_VERSION);
    const writes = vi.spyOn(storageService, 'setRaw');
    await expect(useAppStore.getState().hydrate()).rejects.toThrow('主数据缺失');
    expect(writes).not.toHaveBeenCalled();
  });
  it('preserves intentionally empty ledger without recreating default channels', async () => {
    vi.spyOn(storageService, 'getJSON').mockImplementation(async <T,>(key: string): Promise<T | null> =>
      key === STORAGE_KEYS.wealthTrackerData ? { channels: [], history: [] } as T : null);
    vi.spyOn(storageService, 'getRaw').mockResolvedValue(APP_VERSION);
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().hydrated).toBe(true);
    expect(useAppStore.getState().channels).toEqual([]);
    expect(useAppStore.getState().history).toEqual([]);
  });
  it('read failure pauses writes and never exposes hydrated default data',async()=>{
    vi.spyOn(storageService,'getJSON').mockRejectedValue(new Error('corrupt source'));
    const writes=vi.spyOn(storageService,'setRaw');
    const paused=vi.spyOn(storageService,'pauseWrites');
    await expect(useAppStore.getState().hydrate()).rejects.toThrow('corrupt source');
    expect(useAppStore.getState().hydrated).toBe(false);
    expect(useAppStore.getState().recoveryError).toBe('corrupt source');
    expect(paused).toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    await expect(storageService.setRaw('probe','empty')).rejects.toThrow('不能写入');
  });
});
