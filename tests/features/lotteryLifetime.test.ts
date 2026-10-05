import { describe, it, expect } from 'vitest';
import type { LotteryState, LotteryTransaction, LotteryProject } from '../../src/types';
import { poolBalance, lifetimeStats, totalPrize, totalStake } from '../../src/features/lottery/lotteryMath';

function tx(partial: Partial<LotteryTransaction> & Pick<LotteryTransaction, 'type' | 'amount'>): LotteryTransaction {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: partial.projectId ?? null,
    occurredAt: partial.occurredAt ?? '2030-01-01T10:00',
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    ...partial,
  } as LotteryTransaction;
}

function project(partial: Partial<LotteryProject> & Pick<LotteryProject, 'id' | 'name' | 'dataCompleteness'>): LotteryProject {
  return {
    category: 'other',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    ...partial,
  } as LotteryProject;
}

function state(partial: Partial<LotteryState>): LotteryState {
  return {
    pool: { id: 'pool', name: '彩票资金池', openingBalance: 0, createdAt: '' },
    projects: [],
    transactions: [],
    settings: { showLotteryAppendix: false },
    ...partial,
  };
}

describe('彩票：Pool Balance vs Lifetime Performance', () => {
  it('Lifetime 包含 summary-only 项目（不漏掉历史汇总）', () => {
    const s = state({
      projects: [project({ id: 'p1', name: '历史项目', dataCompleteness: 'summary-only', legacySummary: { income: 0, expense: 100, netProfitLoss: -100 } })],
    });
    const lt = lifetimeStats(s);
    expect(lt.stake).toBe(100);
    expect(lt.net).toBe(-100);
  });

  it('Lifetime 同时计入 detailed + summary-only，不 double-count', () => {
    const s = state({
      projects: [
        project({ id: 'p1', name: '历史项目', dataCompleteness: 'summary-only', legacySummary: { income: 0, expense: 100, netProfitLoss: -100 } }),
        project({ id: 'p2', name: '详细项目', dataCompleteness: 'detailed' }),
      ],
      transactions: [
        tx({ type: 'prize', amount: 150, projectId: 'p2' }),
        tx({ type: 'stake', amount: 100, projectId: 'p2' }),
      ],
    });
    const lt = lifetimeStats(s);
    // Lifetime Prize = 0 (summary) + 150 (detailed) = 150；Stake = 100 + 100 = 200；Net = -50
    expect(lt.prize).toBe(150);
    expect(lt.stake).toBe(200);
    expect(lt.net).toBe(-50);
  });

  it('Pool Balance 只基于 ledger transactions，Legacy Summary 不影响当前资金池', () => {
    const s = state({
      pool: { id: 'pool', name: '彩票资金池', openingBalance: 500, createdAt: '' },
      projects: [
        project({ id: 'p1', name: '历史项目', dataCompleteness: 'summary-only', legacySummary: { income: 0, expense: 1000, netProfitLoss: -1000 } }),
      ],
      transactions: [
        tx({ type: 'capital-injection', amount: 200, projectId: null }),
        tx({ type: 'stake', amount: 100, projectId: null }),
        tx({ type: 'prize', amount: 50, projectId: null }),
      ],
    });
    // Pool = 500 + 200 - 100 + 50 = 650（Legacy -1000 不影响）
    expect(poolBalance(s)).toBe(650);
    // Lifetime 包含历史项目：Prize 50、Stake 100 + 1000 = 1100、Net = -1050
    const lt = lifetimeStats(s);
    expect(lt.net).toBe(-1050);
  });

  it('当前 ledger prize/stake 与 lifetime 区分清楚', () => {
    const s = state({
      projects: [project({ id: 'p1', name: '历史', dataCompleteness: 'summary-only', legacySummary: { income: 0, expense: 100, netProfitLoss: -100 } })],
      transactions: [tx({ type: 'prize', amount: 150, projectId: null })],
    });
    expect(totalPrize(s)).toBe(150); // ledger
    expect(totalStake(s)).toBe(0);
    const lt = lifetimeStats(s);
    expect(lt.prize).toBe(150); // 0 + 150
    expect(lt.stake).toBe(100); // legacy
  });

  it('未归属交易（无 projectId 的 prize/stake）计入 Lifetime', () => {
    const s = state({
      transactions: [
        tx({ type: 'prize', amount: 30, projectId: null }),
        tx({ type: 'stake', amount: 20, projectId: null }),
      ],
    });
    const lt = lifetimeStats(s);
    expect(lt.prize).toBe(30);
    expect(lt.stake).toBe(20);
    expect(lt.unassignedCount).toBe(2);
  });
});
