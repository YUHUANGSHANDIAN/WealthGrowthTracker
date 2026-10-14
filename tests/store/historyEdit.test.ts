import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageService } from '../../src/services/storage';
import { useAppStore } from '../../src/store/appStore';

const history = [{ date: '2026-10-11', totalAmount: 100, eventNote: '保留备注' }, { date: '2026-10-12', totalAmount: 200 }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useAppStore.setState({ hydrated: true, recoveryError: null, maintenanceLabel: null, history });
  vi.spyOn(storageService, 'flush').mockResolvedValue();
  vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  useAppStore.setState({ hydrated: false, maintenanceLabel: null });
});

describe('history edit Store transaction', () => {
  it('commits an approved overwrite and date move in exactly one ledger revision', async () => {
    const actions = useAppStore.getState();
    const proposal = actions.prepareHistoryEdit({ sourceDate: history[0]!.date, date: history[1]!.date, totalAmount: 125 }, actions.dataRevision);
    await actions.confirmHistoryEdit(proposal, true);
    expect(useAppStore.getState().history).toEqual([expect.objectContaining({ date: history[1]!.date, totalAmount: 125, eventNote: '保留备注' })]);
    expect(useAppStore.getState().dataRevision).toBe(actions.dataRevision + 1);
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it.each(['failure', 'null'])('preserves all records on %s backup', async outcome => {
    const backup = outcome === 'failure' ? vi.fn().mockRejectedValue(new Error('backup failed')) : vi.fn().mockResolvedValue(null);
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue({ backupNow: backup } as never);
    const actions = useAppStore.getState();
    const proposal = actions.prepareHistoryEdit({ sourceDate: history[0]!.date, date: '2026-10-13', totalAmount: 125 }, actions.dataRevision);
    await expect(actions.confirmHistoryEdit(proposal)).rejects.toThrow();
    expect(useAppStore.getState().history).toEqual(history);
    expect(useAppStore.getState().dataRevision).toBe(actions.dataRevision);
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it('blocks concurrent writes while awaiting a backup', async () => {
    let finishBackup!: (value: string) => void;
    const backup = new Promise<string>(resolve => { finishBackup = resolve; });
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue({ backupNow: () => backup } as never);
    const actions = useAppStore.getState();
    const proposal = actions.prepareHistoryEdit({ sourceDate: history[0]!.date, date: '2026-10-13', totalAmount: 125 }, actions.dataRevision);
    const pending = actions.confirmHistoryEdit(proposal);
    expect(() => actions.deleteHistoryPoint(history[0]!.date)).toThrow('正在保存历史变更');
    await Promise.resolve();
    finishBackup('backup.json');
    await pending;
    expect(useAppStore.getState().history.map(point => point.date)).toEqual(['2026-10-12', '2026-10-13']);
  });

  it('rejects an editor opened before another ledger change', () => {
    const actions = useAppStore.getState();
    useAppStore.setState({ history: [...history, { date: '2026-10-13', totalAmount: 250 }] });
    expect(() => actions.prepareHistoryEdit({ date: '2026-10-14', totalAmount: 100 }, actions.dataRevision)).toThrow('数据已变化');
  });
});
