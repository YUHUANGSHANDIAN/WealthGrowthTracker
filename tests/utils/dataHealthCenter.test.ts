import { describe, it, expect } from 'vitest';
import type { LotteryState } from '../../src/types';
import { checkLotteryHealth, checkDataHealth, checkReportHealth } from '../../src/utils/dataHealth';
import { useNavigationStore } from '../../src/store/navigationStore';

function lotteryState(): LotteryState {
  return {
    pool: { id: 'pool', name: '彩票资金池', openingBalance: 0, createdAt: '' },
    projects: [{ id: 'p1', name: '项目A', category: 'sports-football', status: 'active', dataCompleteness: 'detailed', createdAt: '', updatedAt: '' }],
    transactions: [],
    settings: { showLotteryAppendix: false },
  };
}

describe('数据健康中心', () => {
  it('彩票资金池为负：不是 Health Error', () => {
    const s = lotteryState();
    s.transactions = [
      { id: 't1', projectId: 'p1', occurredAt: '2026-07-21T10:00', type: 'stake', amount: 1000, source: 'manual', createdAt: '', updatedAt: '' },
    ];
    const issues = checkLotteryHealth(s);
    // Pool 为负不会产生 issue
    expect(issues.some((i) => i.title.includes('负'))).toBe(false);
  });

  it('彩票交易金额 <= 0 是 Error', () => {
    const s = lotteryState();
    s.transactions = [
      { id: 't1', projectId: 'p1', occurredAt: '2026-07-21T10:00', type: 'stake', amount: 0, source: 'manual', createdAt: '', updatedAt: '' },
    ];
    const issues = checkLotteryHealth(s);
    expect(issues.some((i) => i.severity === 'error' && i.domain === 'lottery')).toBe(true);
  });

  it('彩票孤儿交易（缺失项目）是 Warning', () => {
    const s = lotteryState();
    s.transactions = [
      { id: 't1', projectId: 'nonexistent', occurredAt: '2026-07-21T10:00', type: 'stake', amount: 10, source: 'manual', createdAt: '', updatedAt: '' },
    ];
    const issues = checkLotteryHealth(s);
    expect(issues.some((i) => i.domain === 'lottery' && i.title.includes('项目'))).toBe(true);
  });

  it('重复历史日期产生 dedupe 修复策略', () => {
    const { issues } = checkDataHealth([], [
      { date: '2026-10-03', totalAmount: 100 },
      { date: '2026-10-03', totalAmount: 200 },
    ]);
    const dup = issues.find((i) => i.title.includes('重复日期'));
    expect(dup).toBeDefined();
    expect(dup?.fix).toBe('dedupe-history');
  });

  it('报告缺少标题产生报告域 issue', () => {
    const issues = checkReportHealth([
      { id: 'r', reportType: 'weekly', startDate: '2026-10-01', endDate: '2026-10-07', title: '', totalAmount: 1, changeAmount: 0, changePercentage: 0, channelDetails: [], isArchived: false, createdAt: '' },
    ]);
    expect(issues.some((i) => i.domain === 'reports')).toBe(true);
  });
});

describe('Navigation', () => {
  it('navigate 切换 tab 并清除跨 tab 定位', () => {
    useNavigationStore.getState().navigate({ tab: 'reports', reportId: 'r1' });
    expect(useNavigationStore.getState().tab).toBe('reports');
    expect(useNavigationStore.getState().reportId).toBe('r1');
    useNavigationStore.getState().navigate({ tab: 'assets' });
    expect(useNavigationStore.getState().tab).toBe('assets');
    expect(useNavigationStore.getState().reportId).toBeUndefined();
  });
});
