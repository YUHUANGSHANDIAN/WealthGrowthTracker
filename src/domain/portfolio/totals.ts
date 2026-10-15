import { moneyDiff, ratio, roundMoney, ratioText, sumMoney } from './decimal';

/**
 * 四种口径必须分别命名、分别显示公式与范围，绝不都叫“总资产”。
 * 主应用既有「总资产」（channels 合计）不受本模块影响。
 */
export type TotalsBasis = 'all-assets' | 'all-net-assets' | 'investable-assets' | 'investable-net-assets';

export interface TotalsInput {
  /** 全部资产（含受限/预付） */
  allAssets: number | null;
  /** 已确认负债合计；未知负债会使净资产不可确定 */
  liabilities: number | null;
  liabilitiesUnknown: boolean;
  /** 明确受限或用途专属、不计入可投资口径的金额 */
  restricted: number | null;
}

export interface TotalsEntry {
  key: TotalsBasis;
  label: string;
  formula: string;
  scope: string;
  amount: number | null;
  /** 不可确定的原因（未知输入），空数组表示可确定 */
  unknowns: string[];
}

export interface PortfolioTotals {
  entries: TotalsEntry[];
  byKey: Record<TotalsBasis, TotalsEntry>;
}

export function portfolioTotals(input: TotalsInput): PortfolioTotals {
  const { allAssets, liabilities, liabilitiesUnknown, restricted } = input;
  const assetsKnown = allAssets !== null;
  const netKnown = assetsKnown && !liabilitiesUnknown && liabilities !== null;
  const investableKnown = assetsKnown && restricted !== null;
  const investableNetKnown = investableKnown && !liabilitiesUnknown && liabilities !== null;

  const entries: TotalsEntry[] = [
    {
      key: 'all-assets',
      label: '全部资产',
      formula: '全部渠道与计划（含受限/预付）合计',
      scope: '所有已确认资产，不含负债',
      amount: assetsKnown ? roundMoney(allAssets) : null,
      unknowns: assetsKnown ? [] : ['缺少资产合计'],
    },
    {
      key: 'all-net-assets',
      label: '全部净资产',
      formula: '全部资产 − 已确认负债',
      scope: '所有已确认资产与负债',
      amount: netKnown ? moneyDiff(allAssets, liabilities) : null,
      unknowns: netKnown ? [] : [assetsKnown ? '负债未确认' : '缺少资产合计'],
    },
    {
      key: 'investable-assets',
      label: '可投资资产',
      formula: '全部资产 − 受限/用途专属资金',
      scope: '可动用资产，不含受限预付',
      amount: investableKnown ? moneyDiff(allAssets, restricted) : null,
      unknowns: investableKnown ? [] : [assetsKnown ? '受限资金范围未确认' : '缺少资产合计'],
    },
    {
      key: 'investable-net-assets',
      label: '可投资净资产',
      formula: '全部资产 − 受限资金 − 已确认负债',
      scope: '可动用资产扣除负债',
      amount: investableNetKnown ? moneyDiff(moneyDiff(allAssets, restricted), liabilities) : null,
      unknowns: investableNetKnown ? [] : [investableKnown ? '负债未确认' : '受限资金或资产未确认'],
    },
  ];

  return {
    entries,
    byKey: entries.reduce((acc, entry) => {
      acc[entry.key] = entry;
      return acc;
    }, {} as Record<TotalsBasis, TotalsEntry>),
  };
}

export interface RatioWithBase {
  value: number | null;
  base: number | null;
  baseLabel: string;
  text: string;
  note?: string;
}

/** 所有比例必须显式带分母；净资产为 0 或负值时停止归一化并说明。 */
export function ratioWithBase(part: number | null, base: number | null, baseLabel: string): RatioWithBase {
  if (part === null || base === null || !Number.isFinite(part) || !Number.isFinite(base)) {
    return { value: null, base, baseLabel, text: 'N/A', note: '输入未知' };
  }
  if (base === 0) {
    return { value: null, base, baseLabel, text: 'N/A', note: '分母为 0，不做比例计算' };
  }
  if (base < 0) {
    return { value: null, base, baseLabel, text: 'N/A', note: '分母为负（净资产为负），比例无意义并停止配比求解' };
  }
  const value = ratio(part, base);
  return { value, base, baseLabel, text: ratioText(value) };
}

/** 计划穿透检查：计划总额与底层穿透 + 未穿透必须守恒，不得与底层重复计入总额。 */
export interface PlanPenetrationCheck {
  planId: string;
  planTotal: number | null;
  penetratedTotal: number | null;
  unpenetratedTotal: number | null;
  consistent: boolean;
  difference: number | null;
  note?: string;
}

export function checkPlanPenetration(
  plan: { id: string; planTotal: number | null; penetratedTotal: number | null; unpenetratedTotal: number | null },
): PlanPenetrationCheck {
  const { planTotal, penetratedTotal, unpenetratedTotal } = plan;
  if (planTotal === null || penetratedTotal === null || unpenetratedTotal === null) {
    return { planId: plan.id, planTotal, penetratedTotal, unpenetratedTotal, consistent: false, difference: null, note: '存在未知金额' };
  }
  const composed = sumMoney([penetratedTotal, unpenetratedTotal]);
  const difference = moneyDiff(planTotal, composed);
  return {
    planId: plan.id,
    planTotal,
    penetratedTotal,
    unpenetratedTotal,
    consistent: difference === 0,
    difference,
    ...(difference === 0 ? {} : { note: '计划总额与穿透明细不一致，禁止重复累加' }),
  };
}
