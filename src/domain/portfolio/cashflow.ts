import { moneyDiff, roundMoney, sumMoney } from './decimal';
import type { CashFlowEvent } from './types';

/**
 * 资金流口径：内部转移与投资买卖不是收支；信用消费同时增加负债与支出；还款只减少现金与负债；
 * 退款冲减原支出；在途资金在“未包含在余额”时不得被重复安排使用。
 */
export interface CashFlowSummary {
  externalIncome: number;
  externalOut: number;
  expenses: number;
  refunds: number;
  netExternal: number;
  internalTransfers: number;
  investmentBuys: number;
  investmentSells: number;
  debtIncrease: number;
  debtRepayment: number;
  interest: number;
  fees: number;
  lotteryOut: number;
  /** 尚未计入余额的在途金额（按方向分别累计） */
  pendingNotIncludedBuy: number;
  pendingNotIncludedSell: number;
  warnings: string[];
}

const INCLUDED = (event: CashFlowEvent): boolean => event.alreadyIncludedInBalance !== false;

export function cashflowSummary(events: readonly CashFlowEvent[]): CashFlowSummary {
  const total = (predicate: (event: CashFlowEvent) => boolean) => sumMoney(events.filter(predicate).map((event) => event.amount));
  const warnings: string[] = [];
  for (const event of events) {
    if ((event.kind === 'pending-buy' || event.kind === 'pending-sell') && event.alreadyIncludedInBalance === undefined) {
      warnings.push(`事件 ${event.id} 未声明在途金额是否已计入余额`);
    }
    if (event.kind === 'refund' && !event.relatedEventId) warnings.push(`退款 ${event.id} 未关联原交易`);
  }

  const externalIncome = total((event) => event.kind === 'external-income');
  const externalOut = total((event) => event.kind === 'external-out');
  const expenses = total((event) => event.kind === 'credit-spend' || event.kind === 'fee');
  const refunds = total((event) => event.kind === 'refund');
  const debtIncrease = total((event) => event.kind === 'credit-spend');
  const debtRepayment = total((event) => event.kind === 'debt-repayment');

  return {
    externalIncome,
    externalOut,
    expenses,
    refunds,
    netExternal: moneyDiff(sumMoney([externalIncome, refunds]), sumMoney([externalOut, expenses])),
    internalTransfers: total((event) => event.kind === 'internal-transfer'),
    investmentBuys: total((event) => event.kind === 'investment-buy'),
    investmentSells: total((event) => event.kind === 'investment-sell'),
    debtIncrease,
    debtRepayment,
    interest: total((event) => event.kind === 'interest'),
    fees: total((event) => event.kind === 'fee'),
    lotteryOut: total((event) => event.kind === 'lottery-out'),
    pendingNotIncludedBuy: sumMoney(events.filter((event) => event.kind === 'pending-buy' && !INCLUDED(event)).map((event) => event.amount)),
    pendingNotIncludedSell: sumMoney(events.filter((event) => event.kind === 'pending-sell' && !INCLUDED(event)).map((event) => event.amount)),
    warnings,
  };
}

/** 可用现金上限：在途未到账的卖出资金不能提前使用。 */
export function usableCash(balance: number | null, summary: CashFlowSummary): number | null {
  if (balance === null || !Number.isFinite(balance)) return null;
  return roundMoney(Math.max(0, balance - summary.pendingNotIncludedBuy));
}
