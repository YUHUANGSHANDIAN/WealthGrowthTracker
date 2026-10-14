import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginLedgerMaintenance, useAppStore } from '../../src/store/appStore';

beforeEach(() => {
  useAppStore.setState({ hydrated: true, recoveryError: null, maintenanceLabel: null, channels: [], history: [], toasts: [] });
});
afterEach(() => { useAppStore.setState({ maintenanceLabel: null, hydrated: false }); });

describe('ledger maintenance reservation', () => {
  it('rejects reentry and late mutations without changing ledger/revision', () => {
    const release = beginLedgerMaintenance('正在恢复');
    const before = useAppStore.getState();
    expect(() => beginLedgerMaintenance('正在迁移')).toThrow('请等待');
    expect(() => before.addParentChannel('迟到的更新', '💰', '#000000')).toThrow('暂时不能编辑');
    expect(() => before.setAppearance({ ...before.appearance, themeMode: 'dark' })).toThrow('暂时不能编辑');
    expect(useAppStore.getState().channels).toBe(before.channels);
    expect(useAppStore.getState().dataRevision).toBe(before.dataRevision);
    before.pushToast('操作状态', 'info');
    const toasts = useAppStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe('操作状态');
    release();
    release();
    expect(useAppStore.getState().maintenanceLabel).toBeNull();
    const releaseNext = beginLedgerMaintenance('正在备份');
    releaseNext();
  });

  it('refuses to reserve an unavailable ledger', () => {
    useAppStore.setState({ hydrated: false });
    expect(() => beginLedgerMaintenance('正在备份')).toThrow('先完成恢复');
  });
});
