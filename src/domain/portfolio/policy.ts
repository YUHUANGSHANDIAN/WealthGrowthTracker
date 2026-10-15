import { moneyDiff, parseDecimal, ratio, roundMoney, toDecimalText } from './decimal';
import type { InvestmentPolicy } from './types';

export interface PolicyFacts {
  /** 暴露标签 → 金额（标签可重叠，不可当互斥资产相加） */
  exposures: Record<string, number>;
  /** 比例分母（通常是可投资资产）；未知则不给比例结论 */
  exposureBase: number | null;
  /** 连续超限次数（按标签） */
  consecutiveBreaches?: Record<string, number>;
  availableCash?: number | null;
}

export interface PolicyBreach {
  key: string;
  level: 'soft' | 'hard';
  exposure: number;
  limit: number;
  base: number | null;
  share: number | null;
  consecutiveBreaches: number | null;
}

export interface TakeProfitState {
  referenceShares: string | null;
  executedCumulative: number;
  /** 下一个未满足的累计目标（0–1） */
  nextTarget: number | null;
  /** 本次新增应执行比例（不是累计目标本身） */
  nextIncrement: number | null;
  /** 本次新增应执行份额（十进制字符串） */
  nextIncrementShares: string | null;
  exhausted: boolean;
  note?: string;
}

export interface PolicyEvaluation {
  breaches: PolicyBreach[];
  takeProfit: TakeProfitState | null;
  notes: string[];
}

export function evaluatePolicy(policy: InvestmentPolicy, facts: PolicyFacts): PolicyEvaluation {
  const notes: string[] = [];
  const breaches: PolicyBreach[] = [];
  for (const limit of policy.riskLimits) {
    const exposure = facts.exposures[limit.key] ?? null;
    if (exposure === null || !Number.isFinite(exposure)) continue;
    const hard = limit.hardLimit;
    const soft = limit.softLimit;
    const level: PolicyBreach['level'] | null =
      hard !== null && exposure > hard ? 'hard' : soft !== null && exposure > soft ? 'soft' : null;
    if (!level) continue;
    breaches.push({
      key: limit.key,
      level,
      exposure: roundMoney(exposure),
      limit: level === 'hard' ? (hard as number) : (soft as number),
      base: facts.exposureBase,
      share: facts.exposureBase === null ? null : ratio(exposure, facts.exposureBase),
      consecutiveBreaches: facts.consecutiveBreaches?.[limit.key] ?? null,
    });
  }
  if (breaches.some((breach) => breach.share === null)) {
    notes.push('缺少比例分母：仅给出金额是否超限，不给出比例结论');
  }
  return { breaches, takeProfit: evaluateTakeProfit(policy), notes };
}

/**
 * 累计止盈：以参考份额为唯一基数，只计算“下一个未满足台阶”的新增量。
 * 例：参考份额 100、台阶 [0.2, 0.5]、已执行 0.2 → 新增 0.3（30 份），不是 0.5（50 份）。
 */
export function evaluateTakeProfit(policy: InvestmentPolicy): TakeProfitState | null {
  const ladder = policy.takeProfit;
  if (!ladder) return null;
  const executed = clamp01(ladder.executedCumulative);
  const steps = [...ladder.steps].map((step) => clamp01(step.cumulativeTarget)).sort((a, b) => a - b);
  const nextTarget = steps.find((target) => target > executed + 1e-9) ?? null;
  const increment = nextTarget === null ? null : nextTarget - executed;
  if (ladder.referenceShares === null) {
    return {
      referenceShares: null,
      executedCumulative: executed,
      nextTarget,
      nextIncrement: increment,
      nextIncrementShares: null,
      exhausted: nextTarget === null,
      note: '缺少参考份额：可以显示台阶状态，但不能计算应执行份额',
    };
  }
  const reference = parseDecimal(ladder.referenceShares, '参考份额');
  return {
    referenceShares: toDecimalText(reference, 4),
    executedCumulative: executed,
    nextTarget,
    nextIncrement: increment,
    nextIncrementShares: increment === null ? null : toDecimalText(reference.mul(increment), 4),
    exhausted: nextTarget === null,
    ...(nextTarget === null ? { note: '所有台阶均已满足，等待新的周期或追加份额' } : {}),
  };
}

/** 记录一次实际执行后的累计比例（只有执行回执才调用）。 */
export function applyExecutedTakeProfit(policy: InvestmentPolicy, executedShares: string): InvestmentPolicy {
  if (!policy.takeProfit || policy.takeProfit.referenceShares === null) return policy;
  const reference = parseDecimal(policy.takeProfit.referenceShares, '参考份额');
  if (reference.lte(0)) return policy;
  const executed = parseDecimal(executedShares, '执行份额');
  const cumulative = clamp01(executed.div(reference).toNumber());
  return {
    ...policy,
    takeProfit: { ...policy.takeProfit, executedCumulative: Math.max(policy.takeProfit.executedCumulative, cumulative) },
  };
}

export interface AllocationGap {
  key: string;
  target: number;
  current: number | null;
  gap: number | null;
  gapAmount: number | null;
}

/** 目标配比偏离（0–1 表述），仅在分母已知时给出金额缺口。 */
export function allocationGaps(policy: InvestmentPolicy, exposures: Record<string, number>, base: number | null): AllocationGap[] {
  const keys = new Set([...Object.keys(policy.targetAllocation), ...Object.keys(exposures)]);
  return [...keys].sort().map((key) => {
    const target = policy.targetAllocation[key] ?? 0;
    const current = base === null ? null : ratio(exposures[key] ?? 0, base);
    const gap = current === null ? null : target - current;
    return { key, target, current, gap, gapAmount: gap === null || base === null ? null : roundMoney(gap * base) };
  }).filter((row) => row.gap === null || Math.abs(row.gap) > 1e-6);
}

/** 为修复超限所需的最小卖出比例/金额（同一持仓多个标签时取最大值，绝不叠加）。 */
export function requiredReduction(holdingExposures: readonly number[], base: number | null): { share: number | null; amount: number | null } {
  if (base === null || base <= 0) return { share: null, amount: null };
  const reductions = holdingExposures.filter((value) => Number.isFinite(value) && value > 0);
  if (!reductions.length) return { share: 0, amount: 0 };
  const share = Math.max(...reductions);
  return { share, amount: roundMoney(share * base) };
}

export function moneyAfter(current: number | null, delta: number): number | null {
  if (current === null || !Number.isFinite(current)) return null;
  return moneyDiff(current, delta);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
