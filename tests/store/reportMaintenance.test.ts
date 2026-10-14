import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageService } from '../../src/services/storage';
import { useAppStore } from '../../src/store/appStore';
import { emptyProjectionQueue } from '../../src/features/reports/projectionQueue';
import type { FinancialReport } from '../../src/types';

const report: FinancialReport = { id: 'r1', reportType: 'monthly', title: '原报告', startDate: '2026-09-01', endDate: '2026-09-30',
  totalAmount: 100, changeAmount: 0, changePercentage: 0, channelDetails: [], isArchived: false, createdAt: '2026-10-01', revision: 1 };
const imported = JSON.stringify({ version: '1.6.1', data: { wealth_tracker_data: { channels: [], history: [] }, financial_reports: [] } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  useAppStore.setState({ hydrated: false, maintenanceLabel: null });
  useAppStore.setState({ hydrated: true, recoveryError: null, channels: [], history: [{ date: '2026-09-30', totalAmount: 100 }], reports: [], reportProjectionQueue: emptyProjectionQueue(), toasts: [] });
  vi.spyOn(storageService, 'flush').mockResolvedValue();
  vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers();
  useAppStore.setState({ hydrated: false, maintenanceLabel: null });
});

describe('report maintenance and projection outbox', () => {
  it('rejects stale edit, repair, import, health repair and backfill previews without a backup or mutation', async () => {
    useAppStore.setState({ reports: [report] });
    const actions = useAppStore.getState();
    const revision = actions.dataRevision;
    useAppStore.setState({ history: [...actions.history, { date: '2026-10-01', totalAmount: 102 }] });
    const before = useAppStore.getState();
    await expect(actions.commitReportEdit('r1', { ...report, totalAmount: 200 }, [], { baseRevision: revision })).rejects.toThrow('变化');
    await expect(actions.repairReport('r1', report, revision)).rejects.toThrow('变化');
    await expect(actions.importData(imported, 'replace', revision)).rejects.toThrow('变化');
    await expect(actions.applyDataFixes(revision)).rejects.toThrow('变化');
    await expect(actions.runMonthlyBackfill(revision)).rejects.toThrow('变化');
    expect(useAppStore.getState().reports).toBe(before.reports);
    expect(useAppStore.getState().history).toBe(before.history);
    expect(useAppStore.getState().dataRevision).toBe(before.dataRevision);
  });

  it.each(['edit', 'import', 'backfill', 'metadata'] as const)('blocks %s when a pre-operation backup is unavailable', async operation => {
    useAppStore.setState({ reports: operation === 'backfill' ? [] : [report] });
    const before = useAppStore.getState();
    const backupNow = vi.fn().mockResolvedValue(null);
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue({ backupNow } as never);
    const pending = operation === 'edit' ? before.commitReportEdit('r1', { ...report, totalAmount: 200 }, [])
      : operation === 'import' ? before.importData(imported)
      : operation === 'metadata' ? before.updateReportMetadata('r1', { customSummary: 'changed' })
      : before.runMonthlyBackfill();
    await expect(pending).rejects.toThrow('备份');
    expect(useAppStore.getState().reports).toBe(before.reports);
    expect(useAppStore.getState().history).toBe(before.history);
    expect(useAppStore.getState().dataRevision).toBe(before.dataRevision);
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it('rejects financial fields through the metadata entry point', async () => {
    useAppStore.setState({ reports: [report] });
    await expect(useAppStore.getState().updateReportMetadata('r1', { totalAmount: 0 } as never)).rejects.toThrow('不允许');
    expect(useAppStore.getState().reports[0]?.totalAmount).toBe(100);
  });

  it.each(['throw', 'null'])('does not commit when the backup result is %s', async outcome => {
    const backupNow = outcome === 'throw' ? vi.fn().mockRejectedValue(new Error('backup failed')) : vi.fn().mockResolvedValue(null);
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue({ backupNow } as never);
    const actions = useAppStore.getState();
    const proposal = actions.prepareReport('monthly', '2026-09-15');
    await expect(actions.confirmReport(proposal)).rejects.toThrow();
    expect(useAppStore.getState().reports).toEqual([]);
    expect(useAppStore.getState().history).toEqual(actions.history);
    expect(useAppStore.getState().dataRevision).toBe(actions.dataRevision);
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
  });

  it('blocks other edits throughout the backup await', async () => {
    let resolveBackup!: (value: string) => void;
    const backup = new Promise<string>(resolve => { resolveBackup = resolve; });
    const manager = { backupNow: () => backup, writeReport: vi.fn().mockResolvedValue(undefined), writeReportIndex: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(manager as never);
    const actions = useAppStore.getState();
    const pending = actions.confirmReport(actions.prepareReport('monthly', '2026-09-15'));
    expect(() => actions.deleteHistoryPoint('2026-09-30')).toThrow('暂时不能编辑');
    resolveBackup('backup.json');
    await pending;
    expect(useAppStore.getState().reports).toHaveLength(1);
    expect(useAppStore.getState().reportProjectionQueue.indexPending).toBe(false);
  });

  it('keeps the canonical report and a durable pending job after file failure, then retries without another report revision', async () => {
    const manager = { backupNow: vi.fn().mockResolvedValue('backup.json'), writeReport: vi.fn().mockRejectedValueOnce(new Error('permission')), writeReportIndex: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(manager as never);
    const actions = useAppStore.getState();
    const report = await actions.confirmReport(actions.prepareReport('monthly', '2026-09-15'));
    expect(useAppStore.getState().reports[0]?.id).toBe(report.id);
    expect(useAppStore.getState().reportProjectionQueue).toMatchObject({ reportIds: [report.id], indexPending: true, attempts: 1 });
    expect(manager.writeReportIndex).not.toHaveBeenCalled();
    const revision = useAppStore.getState().dataRevision;
    await actions.retryReportProjection();
    expect(useAppStore.getState().reportProjectionQueue).toMatchObject({ reportIds: [], indexPending: false, lastError: null });
    expect(useAppStore.getState().dataRevision).toBe(revision);
    expect(manager.writeReportIndex).toHaveBeenCalledOnce();
  });
});
