import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HealthAssistantDrawer } from '../../src/features/data/HealthAssistantDrawer';
import { useAppStore } from '../../src/store/appStore';
import { useAIConnectionStore } from '../../src/store/aiConnectionStore';
import { useHealthAssistantStore } from '../../src/store/healthAssistantStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { emptyHealthAssistantState } from '../../src/domain/healthAssistant/state';
import { checkDataHealth } from '../../src/utils/dataHealth';

const history = [
  { date: '2026-01-01', totalAmount: 10 },
  { date: '2026-01-01', totalAmount: 20 },
];

beforeEach(() => {
  useAppStore.setState({
    hydrated: true,
    recoveryError: null,
    maintenanceLabel: null,
    ledgerIdentity: { schemaVersion: 1, ledgerId: 'ledger-test', createdAt: '2026-01-01T00:00:00.000Z' },
    dataRevision: 3,
    channels: [],
    history,
    reports: [],
    levelAchievements: [],
    goalAchieved: { hasAchievedGoal: false },
    toasts: [],
  });
  useWorkspaceStore.setState({ amountsHidden: false });
  useAIConnectionStore.setState({ enabled: false, busy: false, profiles: [], activeProfileId: null, connectionRevision: 0 });
  useHealthAssistantStore.setState({
    hydrated: true,
    loading: false,
    loadError: null,
    state: emptyHealthAssistantState(),
  });
});

describe('health assistant authorization UI', () => {
  it('keeps manual health workflows available without an AI connection', () => {
    const issue = checkDataHealth([], history).issues.find((item) => item.fix === 'dedupe-history')!;
    render(<HealthAssistantDrawer open issue={issue} onClose={vi.fn()} onPreviewFix={vi.fn()} />);
    expect(screen.getByText('连接未就绪')).toBeInTheDocument();
    expect(screen.getByText(/人工健康检查和修复仍可继续/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('你的问题'), { target: { value: '这个提示会改余额吗？' } });
    expect(screen.getByRole('button', { name: '预览本次发送内容' })).toBeDisabled();
  });
});
