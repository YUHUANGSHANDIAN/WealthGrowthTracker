import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageService } from '../../src/services/storage';
import { useAppStore } from '../../src/store/appStore';
import type { Channel, HistoryPoint } from '../../src/types';

const channels: Channel[] = [
  { id: 'cash', name: '现金', emoji: '💵', amount: 100, color: '#22c55e', isParent: true, isExpanded: false },
];
const history: HistoryPoint[] = [{ date: '2026-10-13', totalAmount: 100, source: 'manual' }];

describe('asset batch Store transaction', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    useAppStore.setState({
      hydrated: true,
      recoveryError: null,
      maintenanceLabel: null,
      dataRevision: 4,
      channels,
      history,
      levelAchievements: [],
      goalAchieved: { hasAchievedGoal: false },
      toasts: [],
    });
    vi.spyOn(storageService, 'flush').mockResolvedValue();
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    useAppStore.setState({ hydrated: false, maintenanceLabel: null });
  });

  it('commits channels and the same-day snapshot together after draining writes', async () => {
    const actions = useAppStore.getState();
    const proposal = actions.prepareAmountBatch([{ parentId: 'cash', amount: 125 }]);
    const revisionBeforeCommit = useAppStore.getState().dataRevision;

    await actions.confirmAmountBatch(proposal);

    const committed = useAppStore.getState();
    expect(committed.channels[0]?.amount).toBe(125);
    expect(committed.history).toHaveLength(1);
    expect(committed.history[0]).toMatchObject({ totalAmount: 125, source: 'live-snapshot' });
    expect(committed.dataRevision).toBe(revisionBeforeCommit + 1);
    expect(storageService.flush).toHaveBeenCalledTimes(2);
    expect(committed.maintenanceLabel).toBeNull();
  });

  it('does not commit when desktop backup fails', async () => {
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue({
      backupNow: vi.fn().mockRejectedValue(new Error('backup failed')),
    } as never);
    const actions = useAppStore.getState();
    const proposal = actions.prepareAmountBatch([{ parentId: 'cash', amount: 125 }]);

    await expect(actions.confirmAmountBatch(proposal)).rejects.toThrow('backup failed');
    expect(useAppStore.getState().channels).toEqual(channels);
    expect(useAppStore.getState().history).toEqual(history);
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it('rejects a proposal that became stale before confirmation', async () => {
    const actions = useAppStore.getState();
    const proposal = actions.prepareAmountBatch([{ parentId: 'cash', amount: 125 }]);
    useAppStore.setState({ channels: [{ ...channels[0]!, amount: 110 }] });

    await expect(actions.confirmAmountBatch(proposal)).rejects.toThrow('数据已变化');
    expect(useAppStore.getState().history).toEqual(history);
  });
});
