import type { LotteryState, LotteryTransaction } from '../../types';
import { round2 } from '../../utils/money';

/**
 * 彩票资金池数学（纯函数、确定性）。
 * 核心原则：彩票完全独立于财富资产，不影响 totalAssets / 财富等级 / 目标 / 预测 / 标准财务报告。
 */

export function defaultLotteryState(): LotteryState {
  return {
    pool: { id: 'lottery_pool', name: '彩票资金池', openingBalance: 0, createdAt: new Date().toISOString() },
    projects: [],
    transactions: [],
    settings: { showLotteryAppendix: false },
  };
}

/** 单笔交易对资金池余额的带符号影响。 */
export function transactionEffect(tx: LotteryTransaction): number {
  switch (tx.type) {
    case 'capital-injection':
      return tx.amount;
    case 'capital-withdrawal':
      return -tx.amount;
    case 'prize':
      return tx.amount;
    case 'stake':
      return -tx.amount;
    case 'adjustment':
      return tx.amount * (tx.direction ?? 1);
  }
}

/** 资金池余额 = 期初 + 注入 − 取出 + 中奖 − 投注 ± 调整。可以小于 0。 */
export function poolBalance(state: LotteryState): number {
  const opening = state.pool?.openingBalance ?? 0;
  return round2(opening + state.transactions.reduce((a, t) => a + transactionEffect(t), 0));
}

export function totalPrize(state: LotteryState): number {
  return round2(state.transactions.filter((t) => t.type === 'prize').reduce((a, t) => a + t.amount, 0));
}

export function totalStake(state: LotteryState): number {
  return round2(state.transactions.filter((t) => t.type === 'stake').reduce((a, t) => a + t.amount, 0));
}

export function totalInjection(state: LotteryState): number {
  return round2(state.transactions.filter((t) => t.type === 'capital-injection').reduce((a, t) => a + t.amount, 0));
}

export function totalWithdrawal(state: LotteryState): number {
  return round2(state.transactions.filter((t) => t.type === 'capital-withdrawal').reduce((a, t) => a + t.amount, 0));
}

/** 净盈亏 = 中奖收入 − 投注支出（资金注入不属于盈利，资金取出不属于亏损）。 */
export function netPL(state: LotteryState): number {
  return round2(totalPrize(state) - totalStake(state));
}

/** 净盈亏率（ROI）= 净盈亏 / 彩票支出。stake 为 0 时返回 null。 */
export function roi(state: LotteryState): number | null {
  const stake = totalStake(state);
  if (stake <= 0) return null;
  return round2((netPL(state) / stake) * 100);
}

export interface ProjectSummary {
  projectId: string;
  prizeIncome: number;
  stakeExpense: number;
  netProfitLoss: number;
  roi: number | null;
  transactionCount: number;
}

/** 某项目的汇总（detailed 项目从交易推导；summary-only 用 legacySummary）。 */
export function projectSummary(state: LotteryState, projectId: string): ProjectSummary {
  const project = state.projects.find((p) => p.id === projectId);
  if (project?.dataCompleteness === 'summary-only' && project.legacySummary) {
    const s = project.legacySummary;
    const roi = s.expense > 0 ? round2((s.netProfitLoss / s.expense) * 100) : null;
    return { projectId, prizeIncome: s.income, stakeExpense: s.expense, netProfitLoss: s.netProfitLoss, roi, transactionCount: 0 };
  }
  const txs = state.transactions.filter((t) => t.projectId === projectId);
  const prize = round2(txs.filter((t) => t.type === 'prize').reduce((a, t) => a + t.amount, 0));
  const stake = round2(txs.filter((t) => t.type === 'stake').reduce((a, t) => a + t.amount, 0));
  const net = round2(prize - stake);
  const r = stake > 0 ? round2((net / stake) * 100) : null;
  return { projectId, prizeIncome: prize, stakeExpense: stake, netProfitLoss: net, roi: r, transactionCount: txs.length };
}

export interface DailyStat {
  date: string;
  prizeIncome: number;
  stakeExpense: number;
  netProfitLoss: number;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  cumulativeNet: number;
}

/** 每日统计（全部由交易动态推导，不持久化）。 */
export function dailyStats(state: LotteryState): DailyStat[] {
  const byDate = new Map<string, LotteryTransaction[]>();
  for (const t of state.transactions) {
    const date = t.occurredAt.slice(0, 10);
    const arr = byDate.get(date) ?? [];
    arr.push(t);
    byDate.set(date, arr);
  }
  const dates = [...byDate.keys()].sort();
  let cumulative = 0;
  return dates.map((date) => {
    const txs = byDate.get(date)!;
    const prize = round2(txs.filter((t) => t.type === 'prize').reduce((a, t) => a + t.amount, 0));
    const stake = round2(txs.filter((t) => t.type === 'stake').reduce((a, t) => a + t.amount, 0));
    const net = round2(prize - stake);
    cumulative = round2(cumulative + net);
    return {
      date,
      prizeIncome: prize,
      stakeExpense: stake,
      netProfitLoss: net,
      transactionCount: txs.length,
      incomeCount: txs.filter((t) => t.type === 'prize').length,
      expenseCount: txs.filter((t) => t.type === 'stake').length,
      cumulativeNet: cumulative,
    };
  });
}
