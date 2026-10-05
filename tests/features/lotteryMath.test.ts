import { describe, it, expect } from 'vitest';
import type { LotteryState, LotteryTransaction } from '../../src/types';
import { poolBalance, netPL, roi, dailyStats, projectSummary } from '../../src/features/lottery/lotteryMath';
import { lotteryTxFingerprint, lotteryTxIdFromFingerprint } from '../../src/features/lottery/lotteryTx';

function tx(partial: Partial<LotteryTransaction> & Pick<LotteryTransaction, 'type' | 'amount'>): LotteryTransaction {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: 'p1',
    occurredAt: partial.occurredAt ?? '2026-07-21T10:00',
    source: 'manual',
    createdAt: '2026-07-21T10:00',
    updatedAt: '2026-07-21T10:00',
    ...partial,
  } as LotteryTransaction;
}

function state(txs: LotteryTransaction[]): LotteryState {
  return { pool: { id: 'pool', name: '彩票资金池', openingBalance: 0, createdAt: '' }, projects: [], transactions: txs, settings: { showLotteryAppendix: false } };
}

describe('彩票资金池数学', () => {
  it('Prize=100, Stake=60 → Net P/L = +40', () => {
    const s = state([tx({ type: 'prize', amount: 100 }), tx({ type: 'stake', amount: 60 })]);
    expect(netPL(s)).toBe(40);
    expect(poolBalance(s)).toBe(40);
  });

  it('Injection=500：Net P/L 不变，Pool Balance +500', () => {
    const s = state([
      tx({ type: 'prize', amount: 100 }),
      tx({ type: 'stake', amount: 60 }),
      tx({ type: 'capital-injection', amount: 500, projectId: null }),
    ]);
    expect(netPL(s)).toBe(40);
    expect(poolBalance(s)).toBe(540);
  });

  it('Withdrawal=200：Net P/L 不变，Pool Balance -200', () => {
    const s = state([
      tx({ type: 'capital-injection', amount: 500, projectId: null }),
      tx({ type: 'capital-withdrawal', amount: 200, projectId: null }),
    ]);
    expect(netPL(s)).toBe(0);
    expect(poolBalance(s)).toBe(300);
  });

  it('Pool Balance 可以为负（不 clamp）', () => {
    const s = state([tx({ type: 'stake', amount: 1000 })]);
    expect(poolBalance(s)).toBe(-1000);
  });

  it('ROI = net / stake', () => {
    const s = state([tx({ type: 'prize', amount: 100 }), tx({ type: 'stake', amount: 60 })]);
    expect(roi(s)).toBeCloseTo(66.67, 1);
  });

  it('stake 为 0 时 ROI 为 null', () => {
    expect(roi(state([]))).toBeNull();
  });

  it('每日统计动态计算累计净盈亏', () => {
    const s = state([
      tx({ type: 'stake', amount: 100, occurredAt: '2026-07-21T10:00' }),
      tx({ type: 'prize', amount: 150, occurredAt: '2026-07-21T11:00' }),
      tx({ type: 'stake', amount: 80, occurredAt: '2026-07-22T10:00' }),
    ]);
    const days = dailyStats(s);
    expect(days).toHaveLength(2);
    expect(days[0]!.netProfitLoss).toBe(50);
    expect(days[0]!.cumulativeNet).toBe(50);
    expect(days[1]!.cumulativeNet).toBe(-30);
    expect(days[0]!.incomeCount).toBe(1);
    expect(days[0]!.expenseCount).toBe(1);
  });

  it('projectSummary：detailed 项目从交易推导', () => {
    const s = { ...state([]), projects: [{ id: 'p1', name: 'X', category: 'other' as const, status: 'active' as const, dataCompleteness: 'detailed' as const, createdAt: '', updatedAt: '' }], transactions: [tx({ type: 'prize', amount: 200, projectId: 'p1' }), tx({ type: 'stake', amount: 100, projectId: 'p1' })] };
    const sum = projectSummary(s, 'p1');
    expect(sum.netProfitLoss).toBe(100);
    expect(sum.transactionCount).toBe(2);
  });

  it('交易指纹幂等：相同字段得到相同 id', () => {
    const a = { occurredAt: '2030-01-01T10:00', type: 'stake' as const, amount: 20, paymentMethod: '支付方式A', description: 'x', status: '已收款' };
    const b = { ...a };
    expect(lotteryTxFingerprint(a)).toBe(lotteryTxFingerprint(b));
    expect(lotteryTxIdFromFingerprint(lotteryTxFingerprint(a))).toBe(lotteryTxIdFromFingerprint(lotteryTxFingerprint(b)));
  });
});
