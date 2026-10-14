import type { HistoryPoint } from '../../types';
import { getLevelByAmount } from '../../constants/levels';
import { round2 } from '../../utils/money';

export interface HistoryEditState {
  history: HistoryPoint[];
  baseRevision: number;
}

export interface HistoryEditCommand {
  sourceDate?: string;
  date: string;
  totalAmount: number;
}

export interface HistoryEditProposal {
  baseRevision: number;
  baseFingerprint: string;
  command: HistoryEditCommand;
  nowIso: string;
  before?: HistoryPoint;
  occupied?: HistoryPoint;
  after: HistoryPoint;
  history: HistoryPoint[];
  clearsComposition: boolean;
  changed: boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const prepared = new WeakMap<HistoryEditProposal, string>();

/** Prepare a move/amount edit together; preparation never changes the ledger. */
export function prepareHistoryEdit(state: HistoryEditState, command: HistoryEditCommand, nowIso = new Date().toISOString()): HistoryEditProposal {
  if (!Number.isSafeInteger(state.baseRevision) || state.baseRevision < 0) throw new Error('数据版本无效');
  if (!validDate(command.date) || (command.sourceDate !== undefined && !validDate(command.sourceDate))) throw new Error('请输入有效日期');
  if (!Number.isFinite(command.totalAmount)) throw new Error('请输入有效金额');
  if (!Number.isFinite(Date.parse(nowIso))) throw new Error('记录时间无效');
  const dates = new Set<string>();
  for (const point of state.history) {
    if (!validDate(point.date) || !Number.isFinite(point.totalAmount) || dates.has(point.date)) throw new Error('历史日期重复或数据无效，请先检查数据');
    dates.add(point.date);
  }
  const source = command.sourceDate === undefined ? undefined : state.history.find(point => point.date === command.sourceDate);
  if (command.sourceDate !== undefined && !source) throw new Error('原历史记录已不存在');
  const target = state.history.find(point => point.date === command.date);
  const occupied = target?.date !== source?.date ? target : undefined;
  const before = source ?? target;
  const totalAmount = round2(command.totalAmount);
  const changed = !source || source.date !== command.date || source.totalAmount !== totalAmount;
  const clearsComposition = !!before?.channels && before.totalAmount !== totalAmount;
  const after: HistoryPoint = changed ? {
    ...before,
    date: command.date,
    totalAmount,
    source: 'manual',
    timestamp: Date.parse(nowIso),
    updatedAt: nowIso,
    wealthLevel: getLevelByAmount(totalAmount).name,
  } : { ...source } as HistoryPoint;
  // An edited aggregate is not evidence of its old channel breakdown. Preserve
  // notes/unknown fields, but never attach a known-inconsistent composition.
  if (clearsComposition) delete after.channels;
  const history = changed
    ? [...state.history.filter(point => point.date !== source?.date && point.date !== command.date), after].sort((a, b) => a.date.localeCompare(b.date))
    : state.history;
  const proposal: HistoryEditProposal = clone({
    baseRevision: state.baseRevision,
    baseFingerprint: JSON.stringify(state.history),
    command: { sourceDate: command.sourceDate, date: command.date, totalAmount },
    nowIso,
    before,
    occupied,
    after,
    history,
    clearsComposition,
    changed,
  });
  prepared.set(proposal, JSON.stringify(proposal));
  return proposal;
}

export function confirmHistoryEdit(state: HistoryEditState, proposal: HistoryEditProposal, overwrite = false): { history: HistoryPoint[]; changed: boolean } {
  const issued = prepared.get(proposal);
  if (!issued) throw new Error('历史预览不是本次准备的变更，请重新准备');
  if (issued !== JSON.stringify(proposal)) throw new Error('历史变更预览已变化，请重新准备');
  if (state.baseRevision !== proposal.baseRevision || JSON.stringify(state.history) !== proposal.baseFingerprint) throw new Error('数据已变化，请重新打开历史记录');
  const rebuilt = prepareHistoryEdit(state, proposal.command, proposal.nowIso);
  if (JSON.stringify(rebuilt) !== JSON.stringify(proposal)) throw new Error('历史变更预览已变化，请重新准备');
  if (rebuilt.occupied && !overwrite) throw new Error('目标日期已有记录，需要明确确认覆盖');
  return { history: clone(rebuilt.history), changed: rebuilt.changed };
}
