import type { Channel, HistoryPoint } from '../../types';
import { getLevelByAmount } from '../../constants/levels';
import { normalizeChannelAmounts, totalAssets } from '../../utils/channels';
import { overwriteHistoryPoint } from '../../utils/history';
import { round2 } from '../../utils/money';
import { todayString } from '../../utils/date';

export interface AmountBatchState {
  channels: Channel[];
  history: HistoryPoint[];
  baseRevision: number;
}

export interface AmountBatchChange {
  parentId: string;
  childId?: string;
  amount: number;
}

export interface AmountBatchRow {
  parentId: string;
  childId?: string;
  path: string;
  before: number;
  after: number;
}

export interface AmountBatchProposal extends AmountBatchState {
  baseFingerprint: string;
  changes: AmountBatchRow[];
  oldTotal: number;
  newTotal: number;
  referenceDate: string;
  nowIso: string;
  changed: boolean;
}

export interface AmountBatchResult {
  channels: Channel[];
  history: HistoryPoint[];
  changed: boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fingerprint = (state: AmountBatchState): string => JSON.stringify([state.channels, state.history]);

function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function assertUniqueIds(channels: readonly Channel[]): void {
  const ids = new Set<string>();
  for (const channel of channels) {
    if (!channel.id || ids.has(channel.id)) throw new Error('渠道 ID 缺失或重复，请先修复数据');
    ids.add(channel.id);
    for (const child of channel.children ?? []) {
      if (!child.id || ids.has(child.id)) throw new Error('渠道 ID 缺失或重复，请先修复数据');
      ids.add(child.id);
      if (child.parentId !== channel.id) throw new Error('子渠道归属无效，请先修复数据');
    }
  }
}

function assertUniqueHistoryDates(history: readonly HistoryPoint[]): void {
  const dates = new Set<string>();
  for (const point of history) {
    if (!isDateString(point.date) || dates.has(point.date)) throw new Error('历史日期无效或重复，请先修复数据');
    dates.add(point.date);
  }
}

/** Build a deterministic, side-effect-free proposal for editing several leaf amounts. */
export function prepareAmountBatch(
  state: AmountBatchState,
  changes: readonly AmountBatchChange[],
  referenceDate = todayString(),
  nowIso = new Date().toISOString(),
): AmountBatchProposal {
  if (!Number.isInteger(state.baseRevision) || state.baseRevision < 0) throw new Error('数据版本无效，请重新加载');
  if (!isDateString(referenceDate)) throw new Error('快照日期无效');
  if (!Number.isFinite(Date.parse(nowIso))) throw new Error('记录时间无效');
  assertUniqueIds(state.channels);
  assertUniqueHistoryDates(state.history);

  const targets = new Set<string>();
  const rows: AmountBatchRow[] = [];
  changes.forEach((change) => {
    if (!change.parentId) throw new Error('渠道 ID 无效');
    if (!Number.isFinite(change.amount) || change.amount < 0) throw new Error('金额必须是有效的非负数字');
    const amount = round2(change.amount);
    const target = JSON.stringify([change.parentId, change.childId ?? null]);
    if (targets.has(target)) throw new Error('同一渠道不能重复提交');
    targets.add(target);

    const parent = state.channels.find((channel) => channel.id === change.parentId);
    if (!parent || !parent.isParent) throw new Error('渠道不存在或不可编辑');
    if (change.childId) {
      const child = parent.children?.find((candidate) => candidate.id === change.childId);
      if (!child) throw new Error('子渠道不存在或归属已变化');
      if (child.amount !== amount) rows.push({ parentId: parent.id, childId: child.id, path: `${parent.name} / ${child.name}`, before: child.amount, after: amount });
    } else {
      if (parent.children?.length) throw new Error('父渠道金额由子渠道汇总，请编辑具体子渠道');
      if (parent.amount !== amount) rows.push({ parentId: parent.id, path: parent.name, before: parent.amount, after: amount });
    }
  });

  let channels = clone(state.channels);
  for (const row of rows) {
    const change = { parentId: row.parentId, childId: row.childId, amount: row.after };
    channels = channels.map((parent) => {
      if (parent.id !== change.parentId) return parent;
      if (change.childId) {
        return {
          ...parent,
          children: parent.children?.map((child) => child.id === change.childId ? { ...child, amount: change.amount, updatedAt: nowIso } : child),
          updatedAt: nowIso,
        };
      }
      return { ...parent, amount: change.amount, updatedAt: nowIso };
    });
  }
  channels = normalizeChannelAmounts(channels);

  const oldTotal = totalAssets(state.channels);
  const newTotal = totalAssets(channels);
  const changed = JSON.stringify(channels) !== JSON.stringify(state.channels);
  let history = clone(state.history);
  if (changed) {
    const snapshot: HistoryPoint = {
      ...history.find((point) => point.date === referenceDate),
      date: referenceDate,
      totalAmount: newTotal,
      channels: clone(channels),
      wealthLevel: getLevelByAmount(newTotal).name,
      timestamp: Date.parse(nowIso),
      updatedAt: nowIso,
      source: 'live-snapshot',
    };
    history = overwriteHistoryPoint(history, snapshot);
  }

  return clone({
    channels,
    history,
    baseRevision: state.baseRevision,
    baseFingerprint: fingerprint(state),
    changes: rows,
    oldTotal,
    newTotal,
    referenceDate,
    nowIso,
    changed,
  });
}

/** Rebuild the candidate at confirmation time and reject stale or altered proposals. */
export function confirmAmountBatch(state: AmountBatchState, proposal: AmountBatchProposal): AmountBatchResult {
  if (state.baseRevision !== proposal.baseRevision || fingerprint(state) !== proposal.baseFingerprint) {
    throw new Error('数据已变化，请重新准备并确认');
  }
  const rebuilt = prepareAmountBatch(
    state,
    proposal.changes.map(({ parentId, childId, after }) => ({ parentId, childId, amount: after })),
    proposal.referenceDate,
    proposal.nowIso,
  );
  if (
    JSON.stringify(rebuilt.channels) !== JSON.stringify(proposal.channels) ||
    JSON.stringify(rebuilt.history) !== JSON.stringify(proposal.history) ||
    rebuilt.oldTotal !== proposal.oldTotal ||
    rebuilt.newTotal !== proposal.newTotal ||
    rebuilt.changed !== proposal.changed
  ) {
    throw new Error('批量编辑预览已变化，请重新准备');
  }
  return clone({ channels: rebuilt.channels, history: rebuilt.history, changed: rebuilt.changed });
}
