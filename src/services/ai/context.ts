import { channelAmount, totalAssets } from '../../utils/channels';
import { useAppStore } from '../../store/appStore';
import type { RuntimeFact } from './client';
import { isDateString, todayString } from '../../utils/date';
import { analyticsKpis } from '../../features/analysis/analytics';
import { round2 } from '../../utils/money';

export interface ContextSelection {
  reportId?: string;
  range?: { start: string; end: string };
  includeChannels: boolean;
  includeHistory: boolean;
  includeLottery: false;
  includeAmounts?: boolean;
  includeDataHealth?: boolean;
  includeRangeSummary?: boolean;
  channelIds?: string[];
  includeGoal?: boolean;
  goalId?: string;
}

export interface ContextManifest extends ContextSelection {
  baseRevision: number;
}

export interface FactPack {
  facts: Array<RuntimeFact & { source: string }>;
  manifest: ContextManifest;
}

const issuedPacks = new WeakMap<FactPack, { baseRevision: number; content: string }>();

function currentState() {
  const state = useAppStore.getState();
  if (!state.hydrated || state.recoveryError) throw new Error('当前数据尚不可用，不能创建 AI 上下文');
  if (!Number.isSafeInteger(state.dataRevision) || state.dataRevision < 0) throw new Error('当前数据版本无效');
  return state;
}

/**
 * Build an explicitly selected, local-only fact pack. The caller cannot choose
 * the base revision: it is captured from the current store snapshot.
 */
export function buildFactPack(selection: ContextSelection): FactPack {
  const state = currentState();
  if (typeof selection.includeChannels !== 'boolean' || typeof selection.includeHistory !== 'boolean') {
    throw new Error('上下文授权选择无效');
  }
  if (selection.includeLottery !== false) throw new Error('彩票上下文尚未实现独立授权');
  for (const field of ['includeAmounts', 'includeDataHealth', 'includeRangeSummary'] as const) {
    if (selection[field] !== undefined && typeof selection[field] !== 'boolean') throw new Error('上下文授权选择无效');
  }
  if (selection.channelIds !== undefined && (!Array.isArray(selection.channelIds) || selection.channelIds.length > 40
    || selection.channelIds.some(id => typeof id !== 'string' || !id || id.length > 128)
    || new Set(selection.channelIds).size !== selection.channelIds.length)) throw new Error('授权渠道选择无效');
  if (selection.includeGoal !== undefined && typeof selection.includeGoal !== 'boolean') throw new Error('上下文授权选择无效');
  if (selection.goalId !== undefined && (typeof selection.goalId !== 'string' || !selection.goalId || selection.goalId.length > 128)) throw new Error('目标授权选择无效');
  if (selection.reportId !== undefined && (typeof selection.reportId !== 'string' || !selection.reportId)) {
    throw new Error('上下文授权选择无效');
  }
  if (selection.range) {
    if (!isDateString(selection.range.start) || !isDateString(selection.range.end) || selection.range.start > selection.range.end) {
      throw new Error('上下文日期范围无效');
    }
  }
  const report = selection.reportId ? state.reports.find((item) => item.id === selection.reportId) : undefined;
  if (selection.reportId && !report) throw new Error('授权报告与实际报告不一致');
  const facts: FactPack['facts'] = [];
  const includeAmounts = selection.includeAmounts !== false;
  const add = (factId: string, label: string, value: number | string, source: string, unit: RuntimeFact['unit'] = 'CNY', asOf?: string) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`事实金额无效：${factId}`);
    if (unit === 'CNY' && !includeAmounts) return;
    if (facts.some((fact) => fact.factId === factId)) throw new Error(`事实 ID 重复：${factId}`);
    if (facts.length >= 48) throw new Error('超过 48 条事实，请缩小授权范围');
    if (String(value).length > 512) throw new Error('事实内容过长，请缩小授权范围');
    facts.push({ factId, label: label.length > 120 ? label.slice(0, 119) + '…' : label, value: String(value), source, unit, ...(asOf && isDateString(asOf) ? { asOf } : {}) });
  };
  if (selection.reportId && report) {
    add('report.total', '报告总资产', report.totalAmount,
      `report:${report.id}:revision:${report.revision ?? 1}`, 'CNY', report.dataAsOf);
    if (report.previousTotalAmount !== undefined) add('report.opening', '报告期初资产', report.previousTotalAmount, `report:${report.id}:revision:${report.revision ?? 1}`, 'CNY', report.startDate);
    add('report.baseline', '期初覆盖状态', report.baselineStatus ?? (report.previousTotalAmount === undefined ? 'unknown' : 'known'), `report:${report.id}`, 'text');
  }
  if (selection.includeHistory) {
    const selected = state.history.filter((history) => !selection.range ||
      (history.date >= selection.range.start && history.date <= selection.range.end)).sort((a, b) => a.date.localeCompare(b.date));
    for (const history of selected) add(`history.${history.date}`, `历史快照 ${history.date}`, history.totalAmount, `history:${history.date}`, 'CNY', history.date);
  }
  if (selection.includeChannels) {
    const channels = report ? report.channels ?? [] : state.channels;
    const available = new Set(channels.flatMap(c => [c.id, ...(c.children ?? []).map(child => child.id)]));
    if (selection.channelIds?.some(id => !available.has(id))) throw new Error('授权渠道已删除或不属于当前报告');
    for (const [index, channel] of channels.entries()) {
      const selected = selection.channelIds === undefined || selection.channelIds.includes(channel.id);
      const selectedChildren = channel.children?.filter(child => selection.channelIds === undefined || selection.channelIds.includes(child.id));
      if (!selected && !selectedChildren?.length) continue;
      if (!Number.isFinite(channel.amount) || channel.children?.some((child) => !Number.isFinite(child.amount))) throw new Error('渠道金额无效');
      const suffix = /^[A-Za-z0-9._:-]{1,100}$/.test(channel.id) ? `id.${channel.id}` : `index.${index}`;
      const source = report ? `report:${report.id}:revision:${report.revision ?? 1}:channel:${channel.id}` : `channel:${channel.id}`;
      if (selected) add(`channel.${channel.id.match(/^[A-Za-z0-9._:-]{1,100}$/) ? channel.id : suffix}`, channel.name, channelAmount(channel), source, 'CNY', report?.dataAsOf ?? todayString());
      if (!includeAmounts) {
        if (channel.children?.length) {
          for (const [childIndex, child] of channel.children.entries()) {
            if (selection.channelIds !== undefined && !selection.channelIds.includes(child.id)) continue;
            add(`target.${index}.${childIndex}`, `${channel.name} / ${child.name}`, JSON.stringify({ parentId: channel.id, childId: child.id }), source, 'text');
          }
        } else add(`target.${index}`, channel.name, JSON.stringify({ parentId: channel.id }), source, 'text');
      } else {
        for (const [childIndex, child] of (selectedChildren ?? []).entries()) add(`child.${index}.${childIndex}`, `${channel.name} / ${child.name}`, child.amount, source + `:child:${child.id}`, 'CNY', report?.dataAsOf ?? todayString());
      }
    }
  }
  if (selection.includeRangeSummary) {
    if (!selection.range) throw new Error('区间指标必须指定起止日期');
    const kpis = analyticsKpis(state.history, state.channels, selection.range.start, selection.range.end);
    const source = `local:metrics:${selection.range.start}:${selection.range.end}`;
    const metrics = [['opening', '区间起点资产', kpis.startTotal], ['closing', '区间期末资产', kpis.currentTotal], ['change', '区间资产变化', kpis.change]] as const;
    for (const [id, label, value] of metrics) {
      if (value === null) add(`range.${id}.unknown`, label, 'unknown', source, 'text');
      else add(`range.${id}`, label, value, source, 'CNY', id === 'opening' ? selection.range.start : selection.range.end);
    }
    add('range.coverage', '区间每日快照覆盖比例', kpis.coverage * 100, source, 'percent');
    add('range.points', '区间有效快照数', kpis.pointCount, source, 'count');
    add('range.meaning', '指标口径', '资产变化不等于投资收益；未提供现金流台账，不能推断收支或变化原因。期初和期末使用所选日期之前最近有效记录，今天期末使用当前渠道余额。', source, 'text');
  }
  if (selection.includeGoal) {
    if (!selection.goalId) throw new Error('请选择一个已授权的目标');
    const goal = state.goals.find(item => item.id === selection.goalId);
    if (!goal) throw new Error('目标已删除，请重新选择');
    const total = totalAssets(state.channels);
    const source = `goal:${goal.id}`;
    add('goal.target', `目标金额：${goal.name}`, goal.targetAmount, source, 'CNY');
    add('goal.deadline', `目标日期：${goal.name}`, goal.targetDateTime, source, 'text');
    add('goal.status', '目标状态', goal.status, source, 'text');
    add('goal.timezone', '目标时区', goal.timezone, source, 'text');
    if (includeAmounts) {
      add('goal.progress', '当前总资产相对目标的进度', round2(goal.targetAmount > 0 ? (total / goal.targetAmount) * 100 : 0), source, 'percent');
      add('goal.remaining', '距目标金额的差额', Math.max(0, goal.targetAmount - total), source, 'CNY');
    }
    add('goal.meaning', '目标情景口径', '当前资产来自渠道余额合计，可能包含并未预留的资金；彩票资金池与终身表现不参与目标、预测或该情景计算。月均所需金额需要你自行假设，应用不提供投资建议。', source, 'text');
  }
  if (selection.includeDataHealth) {
    // Counts explain coverage without exposing private labels, notes or account values.
    add('health.historyCount', '历史记录数', state.history.length, 'local:history', 'count');
    add('health.reportCount', '报告数', state.reports.length, 'local:reports', 'count');
    add('health.duplicateDates', '重复历史日期数', state.history.length - new Set(state.history.map(h => h.date)).size, 'local:history', 'count');
    add('health.missingSnapshots', '缺少渠道快照的历史记录数', state.history.filter(h => !h.channels?.length).length, 'local:history', 'count');
  }
  const pack: FactPack = {
    facts,
    manifest: {
      baseRevision: state.dataRevision,
      ...(selection.reportId ? { reportId: selection.reportId } : {}),
      ...(selection.range ? { range: { start: selection.range.start, end: selection.range.end } } : {}),
      includeChannels: selection.includeChannels,
      includeHistory: selection.includeHistory,
      includeLottery: false,
      includeAmounts,
      includeDataHealth: selection.includeDataHealth === true,
      includeRangeSummary: selection.includeRangeSummary === true,
      ...(selection.channelIds ? { channelIds: [...selection.channelIds] } : {}),
      includeGoal: selection.includeGoal === true,
      ...(selection.goalId ? { goalId: selection.goalId } : {}),
    },
  };
  issuedPacks.set(pack, { baseRevision: state.dataRevision, content: JSON.stringify(pack) });
  return pack;
}

/** Reject a prepared AI operation after any intervening local data change. */
export function assertFactPackCurrent(pack: FactPack): void {
  const issued = issuedPacks.get(pack);
  if (!issued || issued.content !== JSON.stringify(pack)) throw new Error('AI 上下文未经本地校验或已被修改');
  if (issued.baseRevision !== currentState().dataRevision) {
    throw new Error('AI 上下文已过期，请重新选择数据范围');
  }
}
