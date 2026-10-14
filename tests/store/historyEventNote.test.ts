import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageService } from '../../src/services/storage';
import { useAppStore } from '../../src/store/appStore';
import { overwriteHistoryPoint } from '../../src/utils/history';
import type { HistoryPoint } from '../../src/types';

const point: HistoryPoint = {
  date: '2026-10-12', totalAmount: 100, source: 'manual',
  timestamp: 1000, updatedAt: '2026-10-12T00:00:00Z',
};

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ hydrated: true, recoveryError: null, maintenanceLabel: null, history: [point] });
  vi.spyOn(storageService, 'flush').mockResolvedValue();
  vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  useAppStore.setState({ hydrated: false, maintenanceLabel: null });
});

describe('history event notes', () => {
  it('updates only the note, preserving the financial snapshot and recorded time', async () => {
    const before = useAppStore.getState();
    await before.setHistoryEventNote(point.date, '  搬家，重新整理账户  ', before.dataRevision);
    expect(useAppStore.getState().history[0]).toMatchObject({ ...point, eventNote: '搬家，重新整理账户' });
    expect(useAppStore.getState().history[0]?.eventNoteUpdatedAt).toBeTruthy();
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it('refuses stale notes and backup failure without changing the snapshot', async () => {
    const before = useAppStore.getState();
    await expect(before.setHistoryEventNote(point.date, 'note', before.dataRevision - 1)).rejects.toThrow('数据已变化');
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue({ backupNow: vi.fn().mockRejectedValue(new Error('backup failed')) } as never);
    await expect(before.setHistoryEventNote(point.date, 'note', before.dataRevision)).rejects.toThrow('backup failed');
    expect(useAppStore.getState().history).toEqual([point]);
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it('retains the event note when report generation replaces the daily snapshot', () => {
    const history = [{ ...point, eventNote: '保留说明', eventNoteUpdatedAt: '2026-10-12T03:00:00Z' }];
    expect(overwriteHistoryPoint(history, { date: point.date, totalAmount: 150, source: 'weekly-report' })[0])
      .toMatchObject({ totalAmount: 150, eventNote: '保留说明', eventNoteUpdatedAt: history[0]?.eventNoteUpdatedAt });
  });
});
