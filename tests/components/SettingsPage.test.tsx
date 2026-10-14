import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { SettingsModal } from '../../src/features/settings/SettingsModal';
import { SETTINGS_SECTIONS } from '../../src/constants/settings';
import { useNavigationStore } from '../../src/store/navigationStore';
import { useAppStore } from '../../src/store/appStore';
import { checkForUpdate } from '../../src/utils/updateCheck';

vi.mock('../../src/utils/updateCheck', () => ({
  checkForUpdate: vi.fn().mockResolvedValue({ latest: '1.7.0', isNewer: false, url: '', assets: [] }),
  recommendAsset: vi.fn().mockReturnValue(null),
}));

const initialAppearance = useAppStore.getState().appearance;

beforeEach(() => {
  vi.clearAllMocks();
  useNavigationStore.getState().navigate({ tab: 'settings' });
  useAppStore.setState({ appearance: initialAppearance });
});

afterEach(() => {
  cleanup();
  useNavigationStore.getState().navigate({ tab: 'overview' });
});

describe('SettingsPage', () => {
  it('provides all categories and the existing profile controls as a page', () => {
    render(<SettingsPage />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const item of SETTINGS_SECTIONS) expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument();
    expect(screen.getByLabelText('昵称')).toBeInTheDocument();
    expect(screen.getByLabelText('默认时区')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存资料' })).toBeInTheDocument();
  });

  it('opens a linked category and applies the real appearance setting', () => {
    useNavigationStore.getState().navigate({ tab: 'settings', settingsSection: 'appearance' });
    render(<SettingsPage />);
    expect(screen.getByRole('button', { name: '显示与无障碍' })).toHaveAttribute('aria-current', 'page');
    fireEvent.change(screen.getByLabelText('主题模式'), { target: { value: 'dark' } });
    expect(useAppStore.getState().appearance.themeMode).toBe('dark');
    expect(screen.getByLabelText('减少动画')).toBeInTheDocument();
  });

  it('keeps category selection in the deep link', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '记录与报告' }));
    expect(window.location.hash).toBe('#/settings?section=records');
    expect(screen.getByRole('heading', { name: '记录与报告' })).toBeInTheDocument();
    expect(screen.getByText('尚未实现')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理历史快照' }));
    expect(useNavigationStore.getState().tab).toBe('history');
  });

  it('describes the AI connection state truthfully and links to the connection center', () => {
    useNavigationStore.getState().navigate({ tab: 'settings', settingsSection: 'ai' });
    render(<SettingsPage />);
    expect(screen.getByText('未启用')).toBeInTheDocument();
    expect(screen.getByText(/逐次授权数据范围/)).toBeInTheDocument();
    expect(screen.getByText(/API Key、本地模型和 mock 都不计入该发布门/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开 AI 连接中心' }));
    expect(useNavigationStore.getState().tab).toBe('ai');
  });

  it('links storage operations to the data center without fake toggles', () => {
    useNavigationStore.getState().navigate({ tab: 'settings', settingsSection: 'storage' });
    render(<SettingsPage />);
    expect(screen.getByText(/未提供云端账户或自动云同步/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开数据中心' }));
    expect(useNavigationStore.getState().tab).toBe('data');
  });

  it('does not claim amount hiding encrypts data or logs are anonymous', () => {
    useNavigationStore.getState().navigate({ tab: 'settings', settingsSection: 'privacy' });
    render(<SettingsPage />);
    expect(screen.getByText(/不代表数据加密/)).toBeInTheDocument();
    expect(screen.getByText(/可能包含渠道名称和金额/)).toBeInTheDocument();
    expect(screen.queryByText(/日志不记录任何金额/)).not.toBeInTheDocument();
    expect(screen.queryByText(/唯一联网行为/)).not.toBeInTheDocument();
  });

  it('only checks updates after an explicit action', async () => {
    useNavigationStore.getState().navigate({ tab: 'settings', settingsSection: 'update' });
    render(<SettingsPage />);
    expect(checkForUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('当前已是最新版')).toBeInTheDocument();
    expect(checkForUpdate).toHaveBeenCalledOnce();
  });

  it('preserves the legacy modal wrapper', () => {
    render(<SettingsModal open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByLabelText('昵称')).toBeInTheDocument();
  });
});
