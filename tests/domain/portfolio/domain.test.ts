import { describe, expect, it } from 'vitest';
import {
  fromLegacyPercent, isDecimalText, moneyDiff, ratio, ratioText, roundMoney, roundingTolerance,
  sumMoney, toDecimalText, withinTolerance,
} from '../../../src/domain/portfolio/decimal';
import { checkPlanPenetration, portfolioTotals, ratioWithBase } from '../../../src/domain/portfolio/totals';
import { cashflowSummary, usableCash } from '../../../src/domain/portfolio/cashflow';
import { reconcile } from '../../../src/domain/portfolio/reconcile';
import { allocationGaps, evaluatePolicy, evaluateTakeProfit, requiredReduction } from '../../../src/domain/portfolio/policy';
import { generateProposal } from '../../../src/domain/portfolio/proposals';
import { goalScenarios, impliedAnnualRate, projectGoal, requiredMonthlyContribution } from '../../../src/domain/portfolio/goalScenarios';
import { assertUniqueSessionKey, canTransition, createDraftSession, monthlyPlanKey, transitionSession } from '../../../src/domain/portfolio/session';
import { validateMonthlySession } from '../../../src/domain/portfolio/invariants';
import type { InvestmentPolicy, MonthlyReview, SourceDocument } from '../../../src/domain/portfolio/types';

const policy = (overrides: Partial<InvestmentPolicy> = {}): InvestmentPolicy => ({
  id: 'policy-a',
  version: 3,
  effectiveFrom: '2026-07-20',
  approvedByUser: true,
  targetAllocation: { equity: 0.5, gold: 0.1 },
  riskLimits: [
    { key: 'equity', softLimit: 0.55, hardLimit: 0.6, buffer: 0.02, consecutiveBreachesAllowed: 2 },
    { key: 'theme', softLimit: 0.2, hardLimit: 0.25, buffer: 0.01, consecutiveBreachesAllowed: 1 },
  ],
  liquidityFloor: 5_000,
  minTradeAmount: 100,
  minTradeShares: null,
  cooldownDays: 0,
  feeRate: 0.0015,
  takeProfit: { referenceShares: '100.0000', steps: [{ cumulativeTarget: 0.2, label: '一阶' }, { cumulativeTarget: 0.5, label: '二阶' }], executedCumulative: 0.2 },
  planLevelExecution: false,
  ...overrides,
});

const document_ = (overrides: Partial<SourceDocument> = {}): SourceDocument => ({
  id: 'doc-1',
  relativePath: 'monthly-planning/ab/abc.docx',
  sha256: 'a'.repeat(64),
  originalName: '微信渠道.docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  platform: 'wechat',
  importedAt: '2026-07-20T10:00:00.000Z',
  integrity: 'ok',
  parseState: 'parsed',
  ...overrides,
});

describe('精度与比例口径', () => {
  it('金额按分舍入，求和逐项舍入', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(moneyDiff(5, 5.001)).toBe(0);
  });
  it('份额/净值用十进制字符串，拒绝科学计数法', () => {
    expect(isDecimalText('12.3456')).toBe(true);
    expect(isDecimalText('1e3')).toBe(false);
    expect(toDecimalText('12.34567', 4)).toBe('12.3457');
    expect(() => toDecimalText('x', 2)).toThrow();
  });
  it('比例内部 0–1，未知一律 N/A 而不是 0%', () => {
    expect(ratio(50, 100)).toBe(0.5);
    expect(ratio(10, 0)).toBeNull();
    expect(ratio(10, null)).toBeNull();
    expect(ratioText(null)).toBe('N/A');
    expect(ratioText(0)).toBe('0.0%');
    expect(fromLegacyPercent(45)).toBe(0.45);
    expect(fromLegacyPercent(null)).toBeNull();
  });
  it('舍入容差按行数推导且仅用于精度差额', () => {
    expect(roundingTolerance(200)).toBe(1);
    expect(withinTolerance(100.4, 100.9, 1)).toBe(true);
    expect(withinTolerance(100, 102, 1)).toBe(false);
  });
});

describe('四口径总额', () => {
  it('分别给出公式与范围，未知不补零', () => {
    const { byKey } = portfolioTotals({ allAssets: 100_000, liabilities: 20_000, liabilitiesUnknown: false, restricted: 10_000 });
    expect(byKey['all-assets'].amount).toBe(100_000);
    expect(byKey['all-net-assets'].amount).toBe(80_000);
    expect(byKey['investable-assets'].amount).toBe(90_000);
    expect(byKey['investable-net-assets'].amount).toBe(70_000);
    expect(byKey['all-assets'].formula).toContain('合计');
  });
  it('负债未知时净资产为不可确定而不是当成 0', () => {
    const { byKey } = portfolioTotals({ allAssets: 100_000, liabilities: null, liabilitiesUnknown: true, restricted: 0 });
    expect(byKey['all-net-assets'].amount).toBeNull();
    expect(byKey['all-net-assets'].unknowns.join()).toContain('负债');
    expect(byKey['investable-net-assets'].amount).toBeNull();
  });
  it('分母为 0 或负数时停止比例计算并说明', () => {
    expect(ratioWithBase(100, 0, '全部资产').value).toBeNull();
    expect(ratioWithBase(100, 0, '全部资产').note).toContain('分母为 0');
    expect(ratioWithBase(100, -5, '净资产').note).toContain('分母为负');
    expect(ratioWithBase(50, 100, '全部资产').text).toBe('50.0%');
  });
  it('计划穿透必须守恒，禁止与底层重复累加', () => {
    const ok = checkPlanPenetration({ id: 'plan', planTotal: 1_000, penetratedTotal: 900, unpenetratedTotal: 100 });
    expect(ok.consistent).toBe(true);
    const bad = checkPlanPenetration({ id: 'plan', planTotal: 1_000, penetratedTotal: 900, unpenetratedTotal: 50 });
    expect(bad.consistent).toBe(false);
    expect(bad.note).toContain('重复累加');
  });
});

describe('现金流口径', () => {
  const event = (kind: Parameters<typeof cashflowSummary>[0][number]['kind'], amount: number, extra: Partial<Parameters<typeof cashflowSummary>[0][number]> = {}) => ({
    id: `${kind}:${amount}:${Math.random()}`,
    kind,
    date: '2026-07-20',
    amount,
    scope: 'all' as const,
    evidence: [],
    quality: { source: 'user-confirmed' as const, attribution: 'confirmed' as const, valuation: 'observed' as const, time: 'settled' as const, review: 'passed' as const },
    ...extra,
  });
  it('内部转移与买卖不计入收支', () => {
    const summary = cashflowSummary([
      event('external-income', 9_600),
      event('internal-transfer', 3_000, { fromChannelId: 'a', toChannelId: 'b' }),
      event('investment-buy', 1_000),
      event('investment-sell', 500),
      event('credit-spend', 800),
      event('debt-repayment', 800),
      event('refund', 100, { relatedEventId: 'x' }),
    ]);
    expect(summary.externalIncome).toBe(9_600);
    expect(summary.expenses).toBe(800);
    expect(summary.refunds).toBe(100);
    expect(summary.netExternal).toBe(8_900);
    expect(summary.internalTransfers).toBe(3_000);
    expect(summary.debtIncrease).toBe(800);
    expect(summary.debtRepayment).toBe(800);
  });
  it('在途未到账资金不能被提前使用', () => {
    const summary = cashflowSummary([event('pending-buy', 2_000, { alreadyIncludedInBalance: false })]);
    expect(summary.pendingNotIncludedBuy).toBe(2_000);
    expect(usableCash(5_000, summary)).toBe(3_000);
    const included = cashflowSummary([event('pending-buy', 2_000, { alreadyIncludedInBalance: true })]);
    expect(usableCash(5_000, included)).toBe(5_000);
  });
});

describe('对账守恒', () => {
  it('来源总额未知时不得判定对平', () => {
    const result = reconcile({ sourceTotal: null, rows: [{ id: 'a', label: '持仓', amount: 100, kind: 'matched' }] });
    expect(result.status).toBe('unknown');
    expect(result.notes.join()).toContain('不得用明细反推');
  });
  it('差额在舍入容差内标记为 tolerance 而不是 balanced', () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ id: `r${index}`, label: `行${index}`, amount: 10, kind: 'matched' as const }));
    const result = reconcile({ sourceTotal: 2_000.4, rows });
    expect(result.tolerance).toBe(1);
    expect(result.status).toBe('balanced-with-tolerance');
  });
  it('存在冲突时不得用平衡项强行通过', () => {
    const result = reconcile({
      sourceTotal: 300,
      rows: [
        { id: 'a', label: 'A', amount: 200, kind: 'matched' },
        { id: 'b', label: 'B', amount: 100, kind: 'conflict' },
      ],
    });
    expect(result.status).toBe('unbalanced');
    expect(result.notes.join()).toContain('冲突');
  });
  it('“全部持有”声明不会当作仅直接基金清单', () => {
    const result = reconcile({ sourceTotal: 100, rows: [{ id: 'a', label: 'A', amount: 100, kind: 'matched' }], scopeNote: '全部持有' });
    expect(result.notes.join()).toContain('全部持有');
  });
});

describe('策略求值与止盈台阶', () => {
  it('超过硬性上限标红，缺少分母时不编造比例', () => {
    const evaluation = evaluatePolicy(policy(), { exposures: { equity: 70_000, gold: 10_000 }, exposureBase: 100_000 });
    const equity = evaluation.breaches.find((breach) => breach.key === 'equity');
    expect(equity?.level).toBe('hard');
    expect(equity?.share).toBeCloseTo(0.7, 6);
    const noBase = evaluatePolicy(policy(), { exposures: { equity: 70_000 }, exposureBase: null });
    expect(noBase.breaches[0]?.share).toBeNull();
    expect(noBase.notes.join()).toContain('缺少比例分母');
  });
  it('累计止盈只计算新增量（100 份参考、已执行 20% → 新增 30 份）', () => {
    const ladder = evaluateTakeProfit(policy());
    expect(ladder?.nextTarget).toBeCloseTo(0.5, 9);
    expect(ladder?.nextIncrement).toBeCloseTo(0.3, 9);
    expect(ladder?.nextIncrementShares).toBe('30.0000');
  });
  it('一次跳档按下一个未满足台阶计算，不累加两个台阶', () => {
    const fresh = policy({ takeProfit: { referenceShares: '100.0000', steps: [{ cumulativeTarget: 0.2, label: '一阶' }, { cumulativeTarget: 0.5, label: '二阶' }], executedCumulative: 0 } });
    expect(evaluateTakeProfit(fresh)?.nextIncrementShares).toBe('20.0000');
  });
  it('缺少参考份额时只给台阶状态', () => {
    const withoutReference = policy({ takeProfit: { referenceShares: null, steps: [{ cumulativeTarget: 0.2, label: '一阶' }], executedCumulative: 0 } });
    const ladder = evaluateTakeProfit(withoutReference);
    expect(ladder?.nextIncrementShares).toBeNull();
    expect(ladder?.note).toContain('缺少参考份额');
  });
  it('同一持仓多个重叠上限只取最大降幅', () => {
    expect(requiredReduction([0.1, 0.2, 0.05], 100_000).amount).toBe(20_000);
    expect(requiredReduction([0, 0], 100_000).amount).toBe(0);
  });
  it('配比缺口只在分母已知时给出金额', () => {
    const gaps = allocationGaps(policy(), { equity: 40_000, gold: 10_000 }, 100_000);
    expect(gaps.find((gap) => gap.key === 'equity')?.gapAmount).toBe(10_000);
    const unknownBase = allocationGaps(policy(), { equity: 40_000 }, null);
    expect(unknownBase.every((gap) => gap.gapAmount === null)).toBe(true);
  });
});

describe('候选生成', () => {
  const facts = {
    investableTotal: 100_000,
    availableCash: 20_000,
    dataRed: false,
    positions: [
      { holdingId: 'h1', label: '主题基金', marketValue: 40_000, exposureTags: ['equity', 'theme'] },
      { holdingId: 'h2', label: '宽基', marketValue: 40_000, exposureTags: ['equity'] },
    ],
  };
  it('数据为红时不生成可执行金额方案', () => {
    const proposal = generateProposal(policy(), { ...facts, dataRed: true }, { sessionKey: 'monthly-planning:2026-07', now: '2026-07-20T00:00:00.000Z' });
    expect(proposal.dataStatus).toBe('red');
    expect(proposal.actions).toHaveLength(0);
    expect(proposal.conflicts[0]).toContain('数据审计为红');
  });
  it('优先用新增资金纠偏', () => {
    const proposal = generateProposal(policy(), facts, { sessionKey: 'monthly-planning:2026-07', now: '2026-07-20T00:00:00.000Z' });
    const buy = proposal.actions.find((action) => action.kind === 'buy');
    expect(buy?.amount).toBeGreaterThan(0);
    expect(buy?.fundingSource).toContain('新增资金');
    // 主题上限 25% 被单一持仓冲破时给出一次卖出，但不会因为同时触碰 equity 而叠加两次
    const sells = proposal.actions.filter((action) => action.kind === 'sell');
    expect(sells).toHaveLength(1);
    expect(sells[0]?.amount).toBe(15_000);
  });
  it('超过硬上限时同一持仓只产生一次卖出（取最大降幅）', () => {
    const proposal = generateProposal(
      policy({ targetAllocation: {}, riskLimits: [{ key: 'equity', softLimit: 0.5, hardLimit: 0.6, buffer: 0, consecutiveBreachesAllowed: 1 }] }),
      { investableTotal: 100_000, availableCash: 0, dataRed: false, positions: [{ holdingId: 'h1', label: '主题', marketValue: 80_000, exposureTags: ['equity', 'theme'] }] },
      { sessionKey: 'monthly-planning:2026-07', now: '2026-07-20T00:00:00.000Z' },
    );
    const sells = proposal.actions.filter((action) => action.kind === 'sell');
    expect(sells).toHaveLength(1);
    expect(sells[0]?.amount).toBe(20_000);
  });
  it('计划只能整体交易时按计划聚合，不产生底层交易', () => {
    const proposal = generateProposal(
      policy({ riskLimits: [{ key: 'equity', softLimit: 0.5, hardLimit: 0.6, buffer: 0, consecutiveBreachesAllowed: 1 }], targetAllocation: {} }),
      {
        investableTotal: 100_000, availableCash: 0, dataRed: false,
        planLevelExecution: { 'plan-1': true },
        positions: [{ holdingId: 'h1', label: '计划底层A', planId: 'plan-1', marketValue: 65_000, exposureTags: ['equity'] }],
      },
      { sessionKey: 'monthly-planning:2026-07', now: '2026-07-20T00:00:00.000Z' },
    );
    const rebalance = proposal.actions.filter((action) => action.kind === 'rebalance');
    expect(rebalance).toHaveLength(1);
    expect(rebalance[0]?.planId).toBe('plan-1');
    expect(rebalance[0]?.amount).toBe(5_000);
    expect(proposal.actions.some((action) => action.holdingId?.startsWith('h'))).toBe(false);
  });
  it('低于最小交易额或冷静期内不生成交易，并给出残余风险说明', () => {
    const proposal = generateProposal(
      policy({ minTradeAmount: 5_000, cooldownDays: 30, targetAllocation: {}, riskLimits: [{ key: 'equity', softLimit: 0.5, hardLimit: 0.6, buffer: 0, consecutiveBreachesAllowed: 1 }] }),
      {
        investableTotal: 100_000, availableCash: 0, dataRed: false, lastTradeAt: '2026-07-10T00:00:00.000Z',
        positions: [{ holdingId: 'h1', label: '主题', marketValue: 80_000, exposureTags: ['equity'] }],
      },
      { sessionKey: 'monthly-planning:2026-07', now: '2026-07-20T00:00:00.000Z' },
    );
    expect(proposal.actions).toHaveLength(0);
    expect(proposal.conflicts.join()).toContain('冷静期');
    expect(proposal.riskStatus).toBe('red');
  });
});

describe('目标情景', () => {
  it('零收益与假设收益分开，且不把假设当预测', () => {
    const zero = projectGoal({ baseAmount: 100_000, monthlyContribution: 2_000, annualRate: null, months: 12 });
    expect(zero.finalAmount).toBe(124_000);
    expect(zero.note).toContain('假设');
    const withRate = projectGoal({ baseAmount: 100_000, monthlyContribution: 2_000, annualRate: 0.05, months: 12 });
    expect(withRate.finalAmount).toBeGreaterThan(124_000);
    expect(withRate.growth).toBeGreaterThan(0);
  });
  it('边界：已达标返回 0，期限无效返回 null', () => {
    expect(requiredMonthlyContribution({ target: 100_000, baseAmount: 120_000, months: 12, annualRate: null })).toBe(0);
    expect(requiredMonthlyContribution({ target: 100_000, baseAmount: 10_000, months: 0, annualRate: null })).toBeNull();
  });
  it('隐含收益率在数学上无解时返回 null，而不是包装成可实现计划', () => {
    expect(impliedAnnualRate({ target: 10_000_000_000, baseAmount: 1_000, monthlyContribution: 0, months: 12 })).toBeNull();
    expect(impliedAnnualRate({ target: 110_000, baseAmount: 100_000, monthlyContribution: 1_000, months: 12 })).toBe(0);
    expect(impliedAnnualRate({ target: 120_000, baseAmount: 100_000, monthlyContribution: 1_000, months: 12 })).toBeGreaterThan(0);
  });
  it('压力情景包含零收益与收入中断', () => {
    const results = goalScenarios(
      { goalId: 'g1', targetAmount: 1_000_000, basis: 'all-net-assets', baselineDate: '2026-07-20', monthlyContribution: 5_000, scenarios: [{ id: 's1', label: '乐观', annualRate: 0.08 }], quality: { source: 'user-confirmed', attribution: 'confirmed', valuation: 'observed', time: 'settled', review: 'passed' } },
      { months: 60, baseAmount: 200_000 },
    );
    expect(results.map((row) => row.id)).toContain('stress-zero');
    expect(results.map((row) => row.id)).toContain('stress-income-stop');
    expect(results.every((row) => row.finalAmount !== null)).toBe(true);
  });
});

describe('会话状态机与不变量', () => {
  const ctx = { parentChannelIds: new Set(['p1']), childIdsByParent: new Map([['p1', new Set(['c1'])]]) };
  it('月键唯一，禁止同月第二份正式会话', () => {
    expect(monthlyPlanKey('2026-07')).toBe('monthly-planning:2026-07');
    expect(() => monthlyPlanKey('2026-13')).toThrow();
    const session = createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-15', now: '2026-07-15T07:00:00.000Z' });
    expect(() => assertUniqueSessionKey([session], session.key)).toThrow('本月已有正式会话');
  });
  it('确认需要方案/策略/数据版本且无错误级问题', () => {
    const session = createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-15', now: '2026-07-15T07:00:00.000Z' });
    const ready: MonthlyReview = { ...session, state: 'planned', policyId: 'policy-a', policyVersion: 3 };
    expect(canTransition('planned', 'confirmed')).toBe(true);
    expect(() => transitionSession(ready, 'confirmed', { now: '2026-07-15T07:00:00.000Z', baseDataRevision: 5 })).toThrow('缺少候选方案');
    const withProposal: MonthlyReview = { ...ready, proposal: { id: 'p', sessionKey: session.key, policyVersion: 3, createdAt: 'now', actions: [], conflicts: [], dataStatus: 'green', riskStatus: 'green', summary: '' } };
    expect(() => transitionSession(withProposal, 'confirmed', { now: 'now', baseDataRevision: 5, issues: [{ code: 'x', severity: 'error', message: '有问题' }] })).toThrow('错误级问题');
    const confirmed = transitionSession(withProposal, 'confirmed', { now: 'now', baseDataRevision: 5 });
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.baseDataRevision).toBe(5);
    expect(canTransition('archived', 'draft')).toBe(false);
  });
  it('不变量：证据、渠道归属、观察重复与旧 AI 结果都不能被放宽', () => {
    const session: MonthlyReview = {
      ...createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-15', now: 'now' }),
      documents: [document_({ integrity: 'hash-mismatch' })],
      holdings: [{ id: 'h1', platform: 'manual', parentChannelId: 'missing', originalName: 'X', currency: 'CNY', productType: 'fund', exposureTags: [] }],
      observations: [
        { id: 'o1', holdingId: 'h1', sessionKey: 'monthly-planning:2026-07', shares: null, marketValue: 100, nav: '1.23', evidence: [], quality: { source: 'evidence', attribution: 'confirmed', valuation: 'observed', time: 'observed', review: 'pending' } },
        { id: 'o2', holdingId: 'h1', sessionKey: 'monthly-planning:2026-07', shares: '10.0000', marketValue: 100, nav: '1', navDate: '2026-07-20', evidence: [{ sourceId: 'doc-1', extractor: 't', extractorVersion: '1' }], quality: { source: 'legacy-ai', attribution: 'confirmed', valuation: 'observed', time: 'observed', review: 'passed' } },
      ],
    };
    const issues = validateMonthlySession(session, ctx);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('document-integrity');
    expect(codes).toContain('holding-parent-missing');
    expect(codes).toContain('observation-duplicate');
    expect(codes).toContain('observed-without-evidence');
    expect(codes).toContain('legacy-ai-passed');
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
  });
});
