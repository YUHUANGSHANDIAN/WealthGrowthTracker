import { parseDecimal, roundMoney, toDecimalText } from './decimal';
import { allocationGaps, evaluatePolicy, evaluateTakeProfit, requiredReduction } from './policy';
import type { InvestmentPolicy, ProposedAction, Proposal } from './types';

export interface ProposalPosition {
  holdingId: string;
  label: string;
  planId?: string;
  marketValue: number | null;
  exposureTags: string[];
  takeProfitEligible?: boolean;
  /** 锁定/受限，不能卖出 */
  locked?: boolean;
}

export interface ProposalFacts {
  investableTotal: number | null;
  availableCash: number | null;
  positions: readonly ProposalPosition[];
  /** 数据审计是否为红：红则禁止生成可执行金额方案 */
  dataRed: boolean;
  dataRedReasons?: string[];
  planLevelExecution?: Readonly<Record<string, boolean>>;
  lastTradeAt?: string | null;
}

export interface ProposalOptions {
  sessionKey: string;
  now: string;
}

const DAY_MS = 86_400_000;
const EPSILON = 1e-9;

/**
 * 确定性候选生成：先用已确认新增资金纠偏，再做必要的降险卖出。
 * 同一持仓同时触及多个重叠上限时只产生一个交易变量（取所需降幅的最大值），不叠加。
 */
export function generateProposal(policy: InvestmentPolicy, facts: ProposalFacts, options: ProposalOptions): Proposal {
  const conflicts: string[] = [];
  const actions: ProposedAction[] = [];
  const exposures: Record<string, number> = {};
  for (const position of facts.positions) {
    if (position.marketValue === null) continue;
    for (const tag of position.exposureTags) exposures[tag] = roundMoney((exposures[tag] ?? 0) + position.marketValue);
  }
  const evaluation = evaluatePolicy(policy, { exposures, exposureBase: facts.investableTotal, availableCash: facts.availableCash });
  if (facts.dataRed) {
    return {
      id: `proposal:${options.sessionKey}`,
      sessionKey: options.sessionKey,
      policyVersion: policy.version,
      createdAt: options.now,
      actions: [],
      conflicts: ['数据审计为红：金额或归属尚未核实，禁止生成可执行金额方案', ...(facts.dataRedReasons ?? [])],
      dataStatus: 'red',
      riskStatus: 'amber',
      summary: '数据未确认，仅提供只读检查清单。',
    };
  }
  if (facts.investableTotal === null) conflicts.push('缺少可投资资产分母：无法计算配比缺口');

  let cash = facts.availableCash ?? 0;
  const minTrade = policy.minTradeAmount ?? 0;
  const buckets = allocationGaps(policy, exposures, facts.investableTotal)
    .filter((gap): gap is typeof gap & { gapAmount: number } => gap.gapAmount !== null && gap.gapAmount > 0)
    .map((gap) => ({ key: gap.key, gapAmount: roundMoney(gap.gapAmount) }))
    .sort((a, b) => b.gapAmount - a.gapAmount || a.key.localeCompare(b.key));
  for (const bucket of buckets) {
    if (cash <= 0) break;
    const amount = roundMoney(Math.min(bucket.gapAmount, cash));
    if (amount < minTrade) {
      conflicts.push(`新增资金不足以满足 ${bucket.key} 的最小交易额 ${minTrade} 元`);
      continue;
    }
    cash = roundMoney(cash - amount);
    actions.push({
      id: `buy:${bucket.key}`,
      kind: 'buy',
      amount,
      shares: null,
      triggers: [`配比缺口 ${bucket.key}`],
      evidence: [],
      fundingSource: '已确认新增资金',
      rationale: `用可用现金补齐 ${bucket.key} 的配比缺口`,
      constraintsApplied: ['优先使用新增资金', `最小交易额 ${minTrade} 元`],
      residuals: [],
      blockers: [],
    });
  }

  const cooldownBlocked = policy.cooldownDays !== null && policy.cooldownDays > 0 && Boolean(facts.lastTradeAt)
    ? daysBetween(facts.lastTradeAt as string, options.now) < policy.cooldownDays
    : false;
  if (cooldownBlocked) conflicts.push(`距上次交易不足 ${policy.cooldownDays} 天冷静期，暂不建议卖出`);

  const planAggregate = new Map<string, number>();
  for (const position of facts.positions) {
    if (position.marketValue === null || position.locked) continue;
    if (policy.takeProfit && position.takeProfitEligible) {
      const ladder = evaluateTakeProfit(policy);
      if (ladder?.nextIncrementShares) {
        actions.push({
          id: `take-profit:${position.holdingId}`,
          kind: 'take-profit',
          holdingId: position.holdingId,
          amount: null,
          shares: ladder.nextIncrementShares,
          triggers: [`累计止盈台阶 ${((ladder.nextTarget ?? 0) * 100).toFixed(1)}%`],
          evidence: [],
          rationale: '按累计止盈台阶计算的本次新增应执行份额',
          constraintsApplied: ['以参考份额为基数', '只计算新增量'],
          residuals: [],
          blockers: ['需要确认当日净值后才能计算金额'],
        });
      }
    }
    const reductions: number[] = [];
    for (const tag of position.exposureTags) {
      const limit = policy.riskLimits.find((entry) => entry.key === tag);
      if (!limit || limit.hardLimit === null || facts.investableTotal === null || facts.investableTotal <= 0) continue;
      const share = position.marketValue / facts.investableTotal;
      const gapShare = share - limit.hardLimit;
      if (gapShare > EPSILON) reductions.push(gapShare);
    }
    const requiredAmount = requiredReduction(reductions, facts.investableTotal).amount ?? 0;
    if (requiredAmount <= 0 || cooldownBlocked) continue;
    const planId = position.planId && facts.planLevelExecution?.[position.planId] ? position.planId : undefined;
    if (planId) {
      planAggregate.set(planId, roundMoney((planAggregate.get(planId) ?? 0) + requiredAmount));
      continue;
    }
    if (requiredAmount < minTrade) {
      conflicts.push(`${position.label} 所需降幅 ${requiredAmount} 元低于最小交易额，保留为残余风险`);
      continue;
    }
    actions.push({
      id: `sell:${position.holdingId}`,
      kind: 'sell',
      holdingId: position.holdingId,
      amount: requiredAmount,
      shares: null,
      triggers: position.exposureTags.filter((tag) => policy.riskLimits.some((limit) => limit.key === tag)),
      evidence: [],
      rationale: '超过硬性风险上限，按所需降幅的最大值一次卖出',
      constraintsApplied: ['同一持仓只计算一次交易变量', `最小交易额 ${minTrade} 元`],
      residuals: [],
      blockers: [],
    });
  }
  for (const [planId, amount] of planAggregate) {
    if (amount < minTrade) {
      conflicts.push(`计划 ${planId} 所需降幅低于最小交易额，保留为残余风险`);
      continue;
    }
    actions.push({
      id: `rebalance:${planId}`,
      kind: 'rebalance',
      planId,
      amount,
      shares: null,
      triggers: ['计划只能整体交易'],
      evidence: [],
      rationale: '按计划整体赎回，不产生不可执行的底层交易',
      constraintsApplied: ['执行单位为计划'],
      residuals: [],
      blockers: [],
    });
  }

  const remainingHard = evaluation.breaches.filter((breach) => breach.level === 'hard');
  const riskStatus: Proposal['riskStatus'] = remainingHard.length && !actions.length ? 'red' : remainingHard.length ? 'amber' : 'green';
  if (!actions.length && conflicts.length) conflicts.push('当前约束下没有可行方案：请补充资料或调整策略');
  return {
    id: `proposal:${options.sessionKey}`,
    sessionKey: options.sessionKey,
    policyVersion: policy.version,
    createdAt: options.now,
    actions,
    conflicts,
    dataStatus: 'green',
    riskStatus,
    summary: actions.length ? `生成 ${actions.length} 条候选（未成交，需你确认后手工执行）` : '没有需要执行的动作',
  };
}

export function applyExecutionToPolicy(policy: InvestmentPolicy, action: ProposedAction): InvestmentPolicy {
  if (action.kind !== 'take-profit' || !action.shares || !policy.takeProfit || policy.takeProfit.referenceShares === null) return policy;
  const reference = parseDecimal(policy.takeProfit.referenceShares, '参考份额');
  if (reference.lte(0)) return policy;
  const executed = parseDecimal(action.shares, '执行份额');
  const cumulative = Math.min(1, Math.max(0, executed.div(reference).toNumber() + policy.takeProfit.executedCumulative));
  return { ...policy, takeProfit: { ...policy.takeProfit, executedCumulative: cumulative } };
}

export function sharesText(value: string): string {
  return toDecimalText(value, 4);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(b - a) / DAY_MS;
}
