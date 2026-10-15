import type { MonthlyReview } from './types';

/** 承接项类型 */
export type CarriedItemKind = 'unfinished-action' | 'pending-settlement' | 'open-research' | 'policy';

/** 承接来源：月会承接的每一项都必须能回溯到这里 */
export interface CarriedOrigin {
  sessionKey: string;
  revision: number;
  itemId: string;
  snapshotAsOf: string;
}

export interface CarriedItem {
  id: string;
  kind: CarriedItemKind;
  label: string;
  detail?: string;
  origin: CarriedOrigin;
  status: 'open' | 'resolved' | 'dropped';
  /** 来源会话在承接后被修订时为 true：必须重新确认，不得自动沿用 */
  stale: boolean;
}

export interface CarryOverInput {
  /** 上月已确认/已归档会话；null 表示首期初始化 */
  previous: MonthlyReview | null;
  nextKey: string;
  nextRevision: number;
}

export interface PeriodContinuity {
  ok: boolean;
  expectedStart: string | null;
  actualStart: string | null;
  message?: string;
}

export interface CarryOverResult {
  items: CarriedItem[];
  /** 新会话的复盘区间起点（= 上月快照时点）；首期为 null，不伪造上期收益 */
  periodStart: string | null;
  continuity: PeriodContinuity;
  notes: string[];
}

export function carryOverKey(origin: CarriedOrigin): string {
  return `${origin.sessionKey}@${origin.revision}:${origin.itemId}`;
}

/**
 * 月初承接：只承接已确认/已归档会话的未完成事项，并为每一项记录来源（会话键 + revision + 原条目 + 原快照时点）。
 * 未完成判定：方案动作中已被拒绝或已完全执行的不再承接；无回执、已接受、已延期、部分执行都保留为待办。
 */
export function carryOverPlan(input: CarryOverInput): CarryOverResult {
  const { previous, nextKey, nextRevision } = input;
  if (!previous) {
    return {
      items: [],
      periodStart: null,
      continuity: { ok: true, expectedStart: null, actualStart: null, message: '首期初始化：没有上月会话可承接，也不伪造上期收益' },
      notes: ['首期初始化：仅建立真实日期的基线，不承接、不补造历史'],
    };
  }
  if (previous.state !== 'confirmed' && previous.state !== 'archived') {
    throw new Error(`只能承接已确认或已归档的会话，当前状态为 ${previous.state}`);
  }
  const notes: string[] = [];
  const items: CarriedItem[] = [];
  const origin = (itemId: string): CarriedOrigin => ({
    sessionKey: previous.key,
    revision: previous.revision,
    itemId,
    snapshotAsOf: previous.snapshotAsOf,
  });

  const executionStatus = new Map<string, string>();
  for (const record of previous.executions) {
    const current = executionStatus.get(record.actionId);
    // 同一动作可能有多条回执（部分执行），以最新一条为准
    if (!current || record.executedAt) executionStatus.set(record.actionId, record.status);
  }
  for (const action of previous.proposal?.actions ?? []) {
    const status = executionStatus.get(action.id) ?? 'pending';
    if (status === 'executed' || status === 'rejected') continue;
    items.push({
      id: `${nextKey}:carry:${action.id}:${nextRevision}`,
      kind: 'unfinished-action',
      label: action.rationale || action.kind,
      detail: `上月状态：${status}`,
      origin: origin(action.id),
      status: 'open',
      stale: false,
    });
  }
  if (previous.proposal?.conflicts?.length) {
    items.push({
      id: `${nextKey}:carry:conflicts:${nextRevision}`,
      kind: 'unfinished-action',
      label: '上月未解决的约束冲突',
      detail: previous.proposal.conflicts.join('；'),
      origin: origin('proposal:conflicts'),
      status: 'open',
      stale: false,
    });
  }
  for (const event of previous.cashFlows) {
    if ((event.kind === 'pending-buy' || event.kind === 'pending-sell') && event.alreadyIncludedInBalance === false) {
      items.push({
        id: `${nextKey}:carry:${event.id}:${nextRevision}`,
        kind: 'pending-settlement',
        label: event.kind === 'pending-buy' ? '在途申购待结算' : '在途赎回待结算',
        detail: `${event.date} · ${event.amount} 元（尚未计入余额）`,
        origin: origin(event.id),
        status: 'open',
        stale: false,
      });
    }
  }
  for (const research of previous.research) {
    if (research.expiryPolicy !== 'dated') {
      items.push({
        id: `${nextKey}:carry:${research.id}:${nextRevision}`,
        kind: 'open-research',
        label: `待复核研究：${research.publisher}`,
        detail: research.excerpt.slice(0, 120),
        origin: origin(research.id),
        status: 'open',
        stale: false,
      });
    }
  }
  if (previous.policyId && previous.policyVersion !== null) {
    items.push({
      id: `${nextKey}:carry:${previous.policyId}@${previous.policyVersion}:${nextRevision}`,
      kind: 'policy',
      label: '沿用上月已确认策略',
      detail: `${previous.policyId} v${previous.policyVersion}`,
      origin: origin(`${previous.policyId}@${previous.policyVersion}`),
      status: 'open',
      stale: false,
    });
  }
  if (!items.length) notes.push('上月没有需要承接的事项');

  const continuity: PeriodContinuity = {
    ok: true,
    expectedStart: previous.snapshotAsOf,
    actualStart: previous.snapshotAsOf,
  };
  return { items, periodStart: previous.snapshotAsOf, continuity, notes };
}

/** 幂等合并：同一来源（会话键 + revision + 条目）不重复承接；已解决/已丢弃的状态优先保留。 */
export function mergeCarryOver(existing: readonly CarriedItem[], incoming: readonly CarriedItem[]): CarriedItem[] {
  const byKey = new Map<string, CarriedItem>();
  for (const item of existing) byKey.set(carryOverKey(item.origin), item);
  for (const item of incoming) {
    const key = carryOverKey(item.origin);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, {
      ...current,
      status: current.status === 'open' ? item.status : current.status,
      stale: current.stale || item.stale,
      ...(item.origin.revision >= current.origin.revision ? { origin: item.origin } : {}),
    });
  }
  return [...byKey.values()];
}

/**
 * 维护来源是否已过期：来源会话 revision 前进后，承接项标记 stale（必须重新确认），
 * 但绝不自动把承接项改成 resolved/dropped。
 */
export function markCarryOverStale(items: readonly CarriedItem[], currentRevisions: ReadonlyMap<string, number>): CarriedItem[] {
  return items.map((item) => {
    const current = currentRevisions.get(item.origin.sessionKey);
    if (current === undefined || current === item.origin.revision) return item;
    return { ...item, stale: true };
  });
}

export interface PeriodContinuityInput {
  previous: MonthlyReview | null;
  nextReviewPeriodStart: string | null;
}

/** 区间端点约定：新会话起点必须等于上月快照时点，避免边界事件被重复计算。 */
export function checkPeriodContinuity(input: PeriodContinuityInput): PeriodContinuity {
  const { previous, nextReviewPeriodStart } = input;
  if (!previous) {
    return {
      ok: nextReviewPeriodStart !== null ? false : true,
      expectedStart: null,
      actualStart: nextReviewPeriodStart,
      ...(nextReviewPeriodStart !== null ? { message: '首期不应有复盘区间起点（不伪造上期）' } : {}),
    };
  }
  if (nextReviewPeriodStart !== previous.snapshotAsOf) {
    return {
      ok: false,
      expectedStart: previous.snapshotAsOf,
      actualStart: nextReviewPeriodStart,
      message: `复盘区间起点应为上月快照时点 ${previous.snapshotAsOf}，当前为 ${nextReviewPeriodStart ?? '未设置'}`,
    };
  }
  return { ok: true, expectedStart: previous.snapshotAsOf, actualStart: nextReviewPeriodStart };
}

export interface CarryOverSummary {
  open: number;
  stale: number;
  byKind: Record<CarriedItemKind, number>;
}

export function summarizeCarryOver(items: readonly CarriedItem[]): CarryOverSummary {
  const byKind: Record<CarriedItemKind, number> = { 'unfinished-action': 0, 'pending-settlement': 0, 'open-research': 0, policy: 0 };
  for (const item of items) byKind[item.kind] += 1;
  return {
    open: items.filter((item) => item.status === 'open').length,
    stale: items.filter((item) => item.stale).length,
    byKind,
  };
}
