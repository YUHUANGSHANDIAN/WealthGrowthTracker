import { moneyDiff, roundingTolerance, roundMoney, sumMoney, withinTolerance } from './decimal';

export type ReconRowKind = 'matched' | 'unassigned' | 'duplicate' | 'out-of-scope' | 'conflict';

export interface ReconRow {
  id: string;
  label: string;
  amount: number | null;
  kind: ReconRowKind;
  note?: string;
}

export interface ReconciliationInput {
  /** 来源声明的总额；未知时不得用明细反推 */
  sourceTotal: number | null;
  rows: readonly ReconRow[];
  /** 覆盖/筛选声明，例如“全部持有”“仅直接基金” */
  scopeNote?: string;
  /** 自定义容差（元）；缺省按行数推导舍入容差 */
  tolerance?: number;
}

export interface Reconciliation {
  matchedAmount: number;
  unassignedAmount: number;
  duplicateAmount: number;
  outOfScopeAmount: number;
  conflictAmount: number;
  /** 未知金额的行数（不计入任何金额合计） */
  unknownCount: number;
  difference: number | null;
  tolerance: number;
  status: 'balanced' | 'balanced-with-tolerance' | 'unbalanced' | 'unknown';
  notes: string[];
}

export function reconcile(input: ReconciliationInput): Reconciliation {
  const notes: string[] = [];
  const amountOf = (kind: ReconRowKind) => sumMoney(input.rows.filter((row) => row.kind === kind).map((row) => row.amount ?? 0));
  const unknownCount = input.rows.filter((row) => row.amount === null).length;
  const tolerance = input.tolerance ?? roundingTolerance(input.rows.length);
  const matchedAmount = amountOf('matched');
  const unassignedAmount = amountOf('unassigned');
  const duplicateAmount = amountOf('duplicate');
  const outOfScopeAmount = amountOf('out-of-scope');
  const conflictAmount = amountOf('conflict');

  if (input.sourceTotal === null) {
    notes.push('来源总额未知：不得用明细反推总额，也不能判定为已对平');
    if (unknownCount > 0) notes.push(`存在 ${unknownCount} 条金额未知的明细`);
    return {
      matchedAmount, unassignedAmount, duplicateAmount, outOfScopeAmount, conflictAmount, unknownCount,
      difference: null, tolerance, status: 'unknown', notes,
    };
  }

  const composed = sumMoney([matchedAmount, unassignedAmount, duplicateAmount, outOfScopeAmount, conflictAmount]);
  const difference = moneyDiff(input.sourceTotal, composed);
  let status: Reconciliation['status'];
  if (conflictAmount > 0) {
    status = 'unbalanced';
    notes.push('存在冲突金额，禁止通过负数平衡项或直接改总额通过');
  } else if (unknownCount > 0) {
    status = 'unknown';
    notes.push(`存在 ${unknownCount} 条金额未知的明细，差额不可判定`);
  } else if (difference === 0) {
    status = 'balanced';
  } else if (withinTolerance(input.sourceTotal, composed, tolerance)) {
    status = 'balanced-with-tolerance';
    notes.push(`差额 ${difference} 元在逐行舍入容差 ${tolerance} 元以内`);
  } else {
    status = 'unbalanced';
    notes.push(`差额 ${roundMoney(difference)} 元超出容差 ${tolerance} 元，需人工解释`);
  }
  if (input.scopeNote && /全部持有/.test(input.scopeNote)) {
    notes.push('来源声明为“全部持有”，不能当作仅直接基金的完整清单用于集合差集推定');
  }
  return {
    matchedAmount, unassignedAmount, duplicateAmount, outOfScopeAmount, conflictAmount, unknownCount,
    difference, tolerance, status, notes,
  };
}
