import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  status: vi.fn(), defaultDir: vi.fn(), inspectRoot: vi.fn(), readCandidate: vi.fn(), repair: vi.fn(),
  pause: vi.fn(), resume: vi.fn(), reload: vi.fn(), hydrate: vi.fn(), toast: vi.fn(),
}));

vi.mock('../../src/services/storage/fs', () => ({
  inspectStorageConfigRecovery: mocks.status,
  getDefaultDataDir: mocks.defaultDir,
  inspectRecoveryRoot: mocks.inspectRoot,
  readRecoveryCandidate: mocks.readCandidate,
  repairStorageConfigFromCandidate: mocks.repair,
}));
vi.mock('../../src/services/storage', () => ({ storageService: {
  getDesktopManager: () => null,
  pauseWrites: mocks.pause, resumeWrites: mocks.resume, reload: mocks.reload,
} }));
vi.mock('../../src/store/appStore', () => ({ useAppStore: { getState: () => ({ hydrate: mocks.hydrate, pushToast: mocks.toast }) } }));

import { RecoveryPanel } from '../../src/features/data/RecoveryPanel';

const raw = JSON.stringify({
  wealth_tracker_data: '{"channels":[],"history":[]}', financial_reports: '[]', unknown: 'preserve',
}, null, 2);

describe('storage config recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.status.mockResolvedValue({ exists: true, damaged: true, detail: '损坏配置' });
    mocks.defaultDir.mockResolvedValue('D:\\synthetic\\wealth');
    mocks.inspectRoot.mockResolvedValue({ canonicalRoot: 'D:\\synthetic\\wealth', hasPrimaryState: true, backups: ['wealth-backup_synthetic.json'] });
    mocks.readCandidate.mockResolvedValue(raw);
    mocks.repair.mockResolvedValue({ canonicalRoot: 'D:\\synthetic\\wealth', preservedConfig: 'synthetic-preserved-config', preservedState: null, durabilityWarning: null });
    mocks.reload.mockResolvedValue(undefined);
    mocks.hydrate.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  async function previewPrimary() {
    const user = userEvent.setup();
    render(<RecoveryPanel error="无法读取配置" />);
    await screen.findByRole('region', { name: '存储配置恢复' });
    await user.click(screen.getByRole('button', { name: '填入默认位置' }));
    await user.click(screen.getByRole('button', { name: '只读检查目录' }));
    const selection = await screen.findByRole('combobox', { name: '选择文件以预览' });
    await user.selectOptions(selection, 'app-state');
    await screen.findByRole('button', { name: '确认保留原配置并使用此主文件' });
    return user;
  }

  it('only inspects until an explicit confirmation and sends exact preview bytes', async () => {
    const user = await previewPrimary();
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.inspectRoot).toHaveBeenCalledWith('D:\\synthetic\\wealth');
    expect(mocks.readCandidate).toHaveBeenCalledWith('D:\\synthetic\\wealth', 'app-state');
    await user.click(screen.getByRole('button', { name: '确认保留原配置并使用此主文件' }));
    await waitFor(() => expect(mocks.hydrate).toHaveBeenCalledOnce());
    expect(mocks.repair).toHaveBeenCalledWith('D:\\synthetic\\wealth', 'app-state', raw);
    expect(mocks.pause.mock.invocationCallOrder[0]!).toBeLessThan(mocks.repair.mock.invocationCallOrder[0]!);
    expect(mocks.repair.mock.invocationCallOrder[0]!).toBeLessThan(mocks.reload.mock.invocationCallOrder[0]!);
    expect(mocks.reload.mock.invocationCallOrder[0]!).toBeLessThan(mocks.hydrate.mock.invocationCallOrder[0]!);
  });

  it('invalidates the previous preview when the root changes', async () => {
    const user = await previewPrimary();
    await user.type(screen.getByRole('textbox', { name: '已有数据目录的绝对路径' }), '-changed');
    expect(screen.queryByRole('button', { name: '确认保留原配置并使用此主文件' })).not.toBeInTheDocument();
    expect(mocks.repair).not.toHaveBeenCalled();
  });

  it('repair conflicts keep writes paused without reloading or hydrating', async () => {
    mocks.repair.mockRejectedValue(new Error('候选数据在检查后已变化'));
    const user = await previewPrimary();
    await user.click(screen.getByRole('button', { name: '确认保留原配置并使用此主文件' }));
    await screen.findByText('候选数据在检查后已变化');
    expect(mocks.pause).toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });

  it('a newer candidate schema never produces a confirmation action', async () => {
    mocks.readCandidate.mockResolvedValue(JSON.stringify({ storageSchemaVersion: 2, revision: 1, payload: {} }));
    const user = userEvent.setup();
    render(<RecoveryPanel error="无法读取配置" />);
    await screen.findByRole('region', { name: '存储配置恢复' });
    await user.click(screen.getByRole('button', { name: '填入默认位置' }));
    await user.click(screen.getByRole('button', { name: '只读检查目录' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: '选择文件以预览' }), 'app-state');
    await screen.findByText('候选文件来自更新版本，当前版本禁止恢复');
    expect(screen.queryByRole('button', { name: '确认保留原配置并使用此主文件' })).not.toBeInTheDocument();
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.pause).toHaveBeenCalled();
  });

  it('does not offer config repair for web or an already valid configuration', async () => {
    mocks.status.mockResolvedValue(null);
    render(<RecoveryPanel error="数据损坏" />);
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    expect(screen.queryByRole('region', { name: '存储配置恢复' })).not.toBeInTheDocument();
    expect(mocks.inspectRoot).not.toHaveBeenCalled();
  });
});
