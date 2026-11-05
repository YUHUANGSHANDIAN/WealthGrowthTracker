import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetTrendsPanel } from '../../src/features/analysis/AssetTrendsPanel';
import { useAppStore } from '../../src/store/appStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import { emptyAssetClassificationState } from '../../src/domain/assets/classification';
import type { Channel, HistoryPoint } from '../../src/types';

const channels: Channel[] = [{
  id: 'alipay', name: '支付宝', emoji: '💙', amount: 0, color: '#3b82f6', isParent: true, isExpanded: true,
  children: [
    { id: 'alipay_fund', name: '基金', emoji: '📊', amount: 80, color: '#3b82f6', parentId: 'alipay' },
    { id: 'alipay_gold', name: '银行黄金', emoji: '🏦', amount: 40, color: '#d97706', parentId: 'alipay' },
  ],
}];

const history: HistoryPoint[] = [
  { date: '2026-10-01', totalAmount: 100, source: 'manual', channels },
  { date: '2026-10-04', totalAmount: 120, source: 'live-snapshot', channels },
];

const initial = useAppStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState({ amountsHidden: false });
  useAppStore.setState({
    history,
    channels,
    reports: [],
    monthlyPlanning: emptyMonthlyPlanningState(),
    assetClassification: emptyAssetClassificationState(),
    hydrated: true,
    recoveryError: null,
  });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ amountsHidden: false });
  useAppStore.setState({
    history: initial.history,
    channels: initial.channels,
    reports: initial.reports,
    monthlyPlanning: initial.monthlyPlanning,
    assetClassification: initial.assetClassification,
    hydrated: initial.hydrated,
    recoveryError: initial.recoveryError,
  });
});

describe('AssetTrendsPanel', () => {
  it('uses historical endpoints and exposes the three views', () => {
    render(<AssetTrendsPanel />);
    expect(screen.getByText('资产历史趋势')).toBeInTheDocument();
    expect(screen.getByText('实际起点资产')).toBeInTheDocument();
    expect(screen.getByText('实际终点资产')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '总资产轨迹' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '渠道结构' }));
    expect(screen.getByRole('tab', { name: '渠道结构' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: '渠道结构演变' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '变动解读' }));
    expect(screen.getByText('余额变化')).toBeInTheDocument();
    expect(screen.getByText(/不能解释为净投入或投资收益/)).toBeInTheDocument();
  });

  it('hides chart and KPI amounts when privacy is enabled', () => {
    useWorkspaceStore.setState({ amountsHidden: true });
    render(<AssetTrendsPanel />);
    expect(screen.getAllByText('••••').length).toBeGreaterThan(0);
    expect(screen.queryByText('¥120.00')).not.toBeInTheDocument();
  });
});
