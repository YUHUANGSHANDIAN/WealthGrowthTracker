import { roundMoney } from './decimal';
import type { GoalBasis } from './types';

const MAX_ANNUAL_RATE = 5; // 500% 年化作为数值求解上界，仅用于数学求解，不代表可行性

function monthlyRate(annualRate: number): number | null {
  if (!Number.isFinite(annualRate) || annualRate <= -1) return null;
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

function futureValue(base: number, contribution: number, rate: number, months: number): number {
  if (Math.abs(rate) < 1e-12) return base + contribution * months;
  const growth = Math.pow(1 + rate, months);
  return base * growth + contribution * (growth - 1) / rate;
}

export interface GoalProjectionInput {
  baseAmount: number | null;
  monthlyContribution: number | null;
  annualRate: number | null;
  months: number;
}

export interface GoalProjection {
  finalAmount: number | null;
  contributions: number | null;
  growth: number | null;
  note?: string;
}

/** 情景外推：基线和投入分别列示，不把假设收益包装成预测。 */
export function projectGoal(input: GoalProjectionInput): GoalProjection {
  const { baseAmount, monthlyContribution, annualRate, months } = input;
  if (baseAmount === null || monthlyContribution === null) {
    return { finalAmount: null, contributions: null, growth: null, note: '缺少基线或投入假设，不能外推' };
  }
  if (!Number.isInteger(months) || months <= 0) {
    return { finalAmount: null, contributions: null, growth: null, note: '期限无效或已到期' };
  }
  const rate = annualRate === null ? 0 : monthlyRate(annualRate);
  if (rate === null) {
    return { finalAmount: null, contributions: null, growth: null, note: '年化假设无效（必须大于 -100%）' };
  }
  const contributions = roundMoney(monthlyContribution * months);
  const final = roundMoney(futureValue(baseAmount, monthlyContribution, rate, months));
  return {
    finalAmount: final,
    contributions,
    growth: roundMoney(final - baseAmount - contributions),
    ...(annualRate === null ? { note: '未设置收益假设，按零收益计算' } : { note: '收益为假设情景，不是预测或承诺' }),
  };
}

export interface RequiredContributionInput {
  target: number;
  baseAmount: number;
  months: number;
  annualRate: number | null;
}

/** 需要的月度投入；已达目标返回 0，无解返回 null。 */
export function requiredMonthlyContribution(input: RequiredContributionInput): number | null {
  const { target, baseAmount, months, annualRate } = input;
  if (!Number.isInteger(months) || months <= 0) return null;
  if (!Number.isFinite(target) || !Number.isFinite(baseAmount)) return null;
  if (target <= baseAmount) return 0;
  const rate = annualRate === null ? 0 : monthlyRate(annualRate);
  if (rate === null) return null;
  if (Math.abs(rate) < 1e-12) return roundMoney((target - baseAmount) / months);
  const growth = Math.pow(1 + rate, months);
  const required = (target - baseAmount * growth) * rate / (growth - 1);
  return required <= 0 ? 0 : roundMoney(required);
}

export interface ImpliedRateInput {
  target: number;
  baseAmount: number;
  monthlyContribution: number;
  months: number;
}

/** 由目标反解隐含年化收益（数学求解，仅用于说明难度，不作为可实现收益率）。 */
export function impliedAnnualRate(input: ImpliedRateInput): number | null {
  const { target, baseAmount, monthlyContribution, months } = input;
  if (!Number.isInteger(months) || months <= 0) return null;
  if (![target, baseAmount, monthlyContribution].every((value) => Number.isFinite(value))) return null;
  if (target <= baseAmount + monthlyContribution * months) return 0;
  const valueAt = (annual: number): number => {
    const rate = monthlyRate(annual);
    if (rate === null) return Number.NEGATIVE_INFINITY;
    return futureValue(baseAmount, monthlyContribution, rate, months);
  };
  if (valueAt(MAX_ANNUAL_RATE) < target) return null; // 上界内无解
  let low = 0;
  let high = MAX_ANNUAL_RATE;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (valueAt(mid) < target) low = mid;
    else high = mid;
  }
  return Number(((low + high) / 2).toFixed(4));
}

export interface GoalScenarioResult {
  id: string;
  label: string;
  finalAmount: number | null;
  note?: string;
}

/** 用户假设情景 + 压力情景（零收益、亏损、收入中断）。 */
export function goalScenarios(basis: GoalBasis, options: { months: number; baseAmount: number | null }): GoalScenarioResult[] {
  const results: GoalScenarioResult[] = basis.scenarios.map((scenario) => {
    const projection = projectGoal({
      baseAmount: options.baseAmount,
      monthlyContribution: basis.monthlyContribution,
      annualRate: scenario.annualRate,
      months: options.months,
    });
    return { id: scenario.id, label: scenario.label, finalAmount: projection.finalAmount, ...(projection.note ? { note: projection.note } : {}) };
  });
  const zero = projectGoal({ baseAmount: options.baseAmount, monthlyContribution: basis.monthlyContribution ?? 0, annualRate: 0, months: options.months });
  results.push({ id: 'stress-zero', label: '压力情景：零收益', finalAmount: zero.finalAmount, ...(zero.note ? { note: zero.note } : {}) });
  const interrupted = projectGoal({ baseAmount: options.baseAmount, monthlyContribution: 0, annualRate: 0, months: options.months });
  results.push({ id: 'stress-income-stop', label: '压力情景：收入中断（停止投入）', finalAmount: interrupted.finalAmount, ...(interrupted.note ? { note: interrupted.note } : {}) });
  return results;
}
