import type { Channel, FinancialReport, HistoryPoint, HistorySource, Money } from '../../types';
import type { FinanceTaskKind, MonthlyPlanningState } from '../portfolio/types';
import type {
  AssetClassificationEvent,
  AssetClassificationState,
  ClassificationSnapshot,
} from '../assets/classification';
import { classificationForChannel } from '../assets/classification';
import { channelAmount, leafChannels, totalAssets } from '../../utils/channels';
import { addDays, monthStart, todayString, weekStart } from '../../utils/date';
import { diffMoney, round2 } from '../../utils/money';
import { parentDirectLabel } from '../../constants/channelTerms';

export type TrendGranularity = 'raw' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type TrendBaselineMode = 'in-range' | 'previous';
export type ClassificationLabelMode = 'as-recorded' | 'current';

export interface AssetTrendPoint {
  bucketStart: string;
  observedAt: string | null;
  value: number | null;
  source?: HistorySource;
  coverage: 'reconciled' | 'total-only' | 'invalid';
}

export interface TrendKpis {
  startValue: number | null;
  startDate: string | null;
  endValue: number | null;
  endDate: string | null;
  baselineOutsideRange: boolean;
  liveValue: number | null;
  liveDate: string | null;
  change: number | null;
  changeRate: number | null;
  max: number | null;
  min: number | null;
  mean: number | null;
  observedDays: number;
  calendarDays: number;
  coverage: number;
}

export interface AssetTrendResult {
  points: AssetTrendPoint[];
  rawPoints: AssetTrendPoint[];
  kpis: TrendKpis;
  granularity: TrendGranularity;
}

export interface CompositionSeries {
  id: string;
  currentName: string;
  recordedNames: string[];
}

export interface CompositionSegment {
  id: string;
  recordedName: string;
  currentName: string;
  value: number | null;
}

export interface CompositionPoint {
  date: string;
  observedAt: string | null;
  missing: boolean;
  segments: CompositionSegment[];
}

export interface ChannelCompositionView {
  series: CompositionSeries[];
  points: CompositionPoint[];
  level: 'parent' | 'leaf';
  parentChannelId: string | null;
}

export interface ChangeExplanation {
  startDate: string | null;
  endDate: string | null;
  totalChange: number | null;
  totalChangeRate: number | null;
  channels: Array<{
    id: string;
    name: string;
    start: number | null;
    end: number | null;
    change: number | null;
  }>;
  classificationEvents: AssetClassificationEvent[];
  reports: Array<{ id: string; title: string; endDate: string }>;
  financeTasks: Array<{ id: string; title: string; snapshotAsOf: string; kind: FinanceTaskKind }>;
  cashFlows: Array<{ id: string; taskId: string; date: string; kind: string; amount: number }>;
  interpretation: string;
}

function validHistory(history: readonly HistoryPoint[]): HistoryPoint[] {
  const byDate = new Map<string, HistoryPoint>();
  for (const point of history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(point.totalAmount)) continue;
    byDate.set(point.date, point);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function inCalendarRange(point: HistoryPoint, start: string, end: string): boolean {
  return point.date >= start && point.date <= end;
}

function coverageKind(point: HistoryPoint): AssetTrendPoint['coverage'] {
  if (!point.channels) return 'total-only';
  try {
    const total = totalAssets(point.channels);
    return round2(total) === round2(point.totalAmount) ? 'reconciled' : 'invalid';
  } catch {
    return 'invalid';
  }
}

function toRawPoint(point: HistoryPoint): AssetTrendPoint {
  return {
    bucketStart: point.date,
    observedAt: point.date,
    value: point.totalAmount,
    ...(point.source ? { source: point.source } : {}),
    coverage: coverageKind(point),
  };
}

function bucketStart(date: string, granularity: TrendGranularity): string {
  switch (granularity) {
    case 'weekly': return weekStart(date);
    case 'monthly': return monthStart(date);
    case 'quarterly': {
      const [year, month] = date.split('-').map(Number);
      return `${year}-${String(Math.floor(((month ?? 1) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    }
    case 'yearly': return `${date.slice(0, 4)}-01-01`;
    default: return date;
  }
}

function nextBucket(date: string, granularity: TrendGranularity): string {
  switch (granularity) {
    case 'weekly': return addDays(date, 7);
    case 'monthly': {
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
    }
    case 'quarterly': {
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      return month >= 10
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 3).padStart(2, '0')}-01`;
    }
    case 'yearly': return `${Number(date.slice(0, 4)) + 1}-01-01`;
    default: return addDays(date, 1);
  }
}

function aggregatePoints(raw: readonly AssetTrendPoint[], granularity: TrendGranularity): AssetTrendPoint[] {
  if (granularity === 'raw') return [...raw];
  const buckets = new Map<string, AssetTrendPoint>();
  for (const point of raw) {
    if (!point.observedAt || point.value === null) continue;
    buckets.set(bucketStart(point.observedAt, granularity), {
      bucketStart: bucketStart(point.observedAt, granularity),
      observedAt: point.observedAt,
      value: point.value,
      ...(point.source ? { source: point.source } : {}),
      coverage: point.coverage,
    });
  }
  return [...buckets.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

function addGapMarkers(points: readonly AssetTrendPoint[], granularity: TrendGranularity): AssetTrendPoint[] {
  const result: AssetTrendPoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && previous.observedAt !== null) {
      const marker = nextBucket(previous.bucketStart, granularity);
      if (marker < point.bucketStart) {
        result.push({ bucketStart: marker, observedAt: null, value: null, coverage: 'invalid' });
      }
    }
    result.push(point);
  }
  return result;
}

function calendarDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000) + 1);
}

export function buildAssetTrend(input: {
  history: readonly HistoryPoint[];
  channels: readonly Channel[];
  startDate: string | null;
  endDate: string;
  granularity: TrendGranularity;
  baselineMode?: TrendBaselineMode;
  includeLive?: boolean;
  today?: string;
}): AssetTrendResult {
  const sorted = validHistory(input.history).filter((point) => point.date <= input.endDate);
  if (!sorted.length) {
    return {
      points: [],
      rawPoints: [],
      granularity: input.granularity,
      kpis: {
        startValue: null, startDate: null, endValue: null, endDate: null,
        baselineOutsideRange: false, liveValue: null, liveDate: null,
        change: null, changeRate: null, max: null, min: null, mean: null,
        observedDays: 0, calendarDays: 0, coverage: 0,
      },
    };
  }
  const rangeStart = input.startDate ?? sorted[0]!.date;
  if (rangeStart > input.endDate) throw new Error('趋势起始日期不能晚于结束日期');
  const inRange = sorted.filter((point) => inCalendarRange(point, rangeStart, input.endDate));
  const previous = [...sorted].reverse().find((point) => point.date < rangeStart) ?? null;
  const baseline = input.baselineMode === 'previous' && previous ? previous : inRange[0] ?? null;
  const endPoint = [...inRange].reverse()[0] ?? null;
  const rawPoints = inRange.map(toRawPoint);
  const points = addGapMarkers(aggregatePoints(rawPoints, input.granularity), input.granularity);
  const values = rawPoints.map((point) => point.value).filter((value): value is number => value !== null);
  const startValue = baseline?.totalAmount ?? null;
  const endValue = endPoint?.totalAmount ?? null;
  const change = startValue === null || endValue === null ? null : diffMoney(endValue, startValue);
  const today = input.today ?? todayString();
  const liveNeeded = input.includeLive === true && input.endDate === today
    && (!endPoint || endPoint.date < today);
  const liveValue = liveNeeded ? totalAssets([...input.channels]) : null;
  const observedDays = new Set(inRange.map((point) => point.date)).size;
  const days = calendarDays(rangeStart, input.endDate);
  return {
    points,
    rawPoints,
    granularity: input.granularity,
    kpis: {
      startValue,
      startDate: baseline?.date ?? null,
      endValue,
      endDate: endPoint?.date ?? null,
      baselineOutsideRange: Boolean(baseline && baseline.date < rangeStart),
      liveValue,
      liveDate: liveLiveDate(liveValue, today),
      change,
      changeRate: change === null || startValue === null || startValue === 0 ? null : round2((change / Math.abs(startValue)) * 100),
      max: values.length ? Math.max(...values) : null,
      min: values.length ? Math.min(...values) : null,
      mean: values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      observedDays,
      calendarDays: days,
      coverage: days > 0 ? Math.min(1, observedDays / days) : 0,
    },
  };
}

function liveLiveDate(value: number | null, today: string): string | null {
  return value === null ? null : today;
}

function channelDisplayName(
  classifications: AssetClassificationState,
  id: string,
  recordedName: string,
  mode: ClassificationLabelMode,
): string {
  if (mode === 'as-recorded') return recordedName;
  return classificationForChannel(classifications, id)?.displayName ?? recordedName;
}

interface ExtractedChannel {
  id: string;
  recordedName: string;
  amount: number;
}

function extractComposition(
  channels: readonly Channel[],
  level: 'parent' | 'leaf',
  parentChannelId: string | null,
): { items: ExtractedChannel[]; total: number } | null {
  if (level === 'parent') {
    return {
      items: channels.map((channel) => ({ id: `parent:${channel.id}`, recordedName: channel.name, amount: channelAmount(channel) })),
      total: totalAssets([...channels]),
    };
  }
  if (parentChannelId) {
    const parent = channels.find((channel) => channel.id === parentChannelId);
    if (!parent) return null;
    if (parent.children?.length) {
      return {
        items: parent.children.map((child) => ({ id: `leaf:${child.id}`, recordedName: child.name, amount: child.amount })),
        total: channelAmount(parent),
      };
    }
    return { items: [{ id: `leaf:${parent.id}`, recordedName: parentDirectLabel(parent.name), amount: channelAmount(parent) }], total: channelAmount(parent) };
  }
  return {
    items: leafChannels([...channels]).map((leaf) => ({
      id: `leaf:${leaf.id}`,
      recordedName: leaf.kind === 'parent-direct' ? parentDirectLabel(leaf.name) : leaf.name,
      amount: leaf.amount,
    })),
    total: totalAssets([...channels]),
  };
}

export function buildChannelComposition(input: {
  history: readonly HistoryPoint[];
  classifications: AssetClassificationState;
  startDate: string | null;
  endDate: string;
  level: 'parent' | 'leaf';
  parentChannelId?: string | null;
  topN: number;
  mode: 'absolute' | 'percent';
  labelMode: ClassificationLabelMode;
}): ChannelCompositionView {
  const sorted = validHistory(input.history).filter((point) => point.date <= input.endDate
    && (!input.startDate || point.date >= input.startDate));
  const parentChannelId = input.parentChannelId ?? null;
  const identities = new Map<string, { currentName: string; names: Set<string>; weight: number }>();
  for (const point of sorted) {
    if (!point.channels) continue;
    const extracted = extractComposition(point.channels, input.level, parentChannelId);
    if (!extracted) continue;
    for (const item of extracted.items) {
      const existing = identities.get(item.id) ?? { currentName: item.recordedName, names: new Set<string>(), weight: 0 };
      existing.names.add(item.recordedName);
      existing.weight += Math.abs(item.amount);
      existing.currentName = channelDisplayName(
        input.classifications,
        item.id.split(':').slice(1).join(':'),
        item.recordedName,
        input.labelMode,
      );
      identities.set(item.id, existing);
    }
  }
  const topIds = [...identities.entries()]
    .sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, input.topN))
    .map(([id]) => id);
  const topSet = new Set(topIds);
  const points: CompositionPoint[] = sorted.map((point) => {
    const extracted = point.channels ? extractComposition(point.channels, input.level, parentChannelId) : null;
    if (!extracted) return { date: point.date, observedAt: null, missing: true, segments: [] };
    const byId = new Map(extracted.items.map((item) => [item.id, item]));
    const knownTop = topIds.map((id) => {
      const item = byId.get(id);
      const identity = identities.get(id);
      return {
        id,
        recordedName: item?.recordedName ?? '未知',
        currentName: identity?.currentName ?? '未知',
        value: item?.amount ?? null,
      };
    });
    const other = round2(extracted.items.filter((item) => !topSet.has(item.id)).reduce((sum, item) => sum + item.amount, 0));
    const known = round2(extracted.items.reduce((sum, item) => sum + item.amount, 0));
    const unrecorded = diffMoney(extracted.total, known);
    const segments: CompositionSegment[] = [...knownTop];
    if (identities.size > topIds.length) {
      segments.push({ id: 'aggregate:other', recordedName: '其他已记录渠道', currentName: '其他已记录渠道', value: other });
    }
    if (unrecorded !== 0) {
      segments.push({ id: 'aggregate:unrecorded', recordedName: '未知/未记录', currentName: '未知/未记录', value: unrecorded });
    }
    const denominator = input.level === 'parent' ? extracted.total : extracted.total;
    if (input.mode === 'percent' && denominator <= 0) {
      return { date: point.date, observedAt: point.date, missing: true, segments: [] };
    }
    return {
      date: point.date,
      observedAt: point.date,
      missing: false,
      segments: input.mode === 'percent'
        ? segments.map((segment) => ({
            ...segment,
            value: segment.value === null ? null : round2((segment.value / denominator) * 100),
          }))
        : segments,
    };
  });
  return {
    level: input.level,
    parentChannelId,
    series: topIds.map((id) => ({
      id,
      currentName: identities.get(id)!.currentName,
      recordedNames: [...identities.get(id)!.names].sort(),
    })),
    points,
  };
}

export function buildChangeExplanation(input: {
  history: readonly HistoryPoint[];
  classifications: AssetClassificationState;
  reports: readonly FinancialReport[];
  planning: MonthlyPlanningState;
  startDate: string | null;
  endDate: string;
}): ChangeExplanation {
  const sorted = validHistory(input.history).filter((point) => point.date <= input.endDate
    && (!input.startDate || point.date >= input.startDate));
  const start = sorted[0] ?? null;
  const end = [...sorted].reverse()[0] ?? null;
  const startMap = start?.channels ? extractComposition(start.channels, 'parent', null)?.items ?? [] : [];
  const endMap = end?.channels ? extractComposition(end.channels, 'parent', null)?.items ?? [] : [];
  const startById = new Map(startMap.map((item) => [item.id, item]));
  const endById = new Map(endMap.map((item) => [item.id, item]));
  const ids = new Set([...startById.keys(), ...endById.keys()]);
  const channels = [...ids].map((id) => {
    const before = startById.get(id);
    const after = endById.get(id);
    return {
      id,
      name: after?.recordedName ?? before?.recordedName ?? id,
      start: before?.amount ?? null,
      end: after?.amount ?? null,
      change: before && after ? diffMoney(after.amount, before.amount) : null,
    };
  }).sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  const totalChange = start && end ? diffMoney(end.totalAmount, start.totalAmount) : null;
  const classificationEvents = input.classifications.events.filter((event) => {
    const date = event.classifiedAt.slice(0, 10);
    return (!input.startDate || date >= input.startDate) && date <= input.endDate;
  });
  const reports = input.reports.filter((report) => report.endDate <= input.endDate
    && (!input.startDate || report.endDate >= input.startDate));
  const financeTasks = input.planning.sessions.filter((task) => task.snapshotAsOf <= input.endDate
    && (!input.startDate || task.snapshotAsOf >= input.startDate));
  const cashFlows = financeTasks.flatMap((task) => task.cashFlows
    .filter((flow) => flow.date <= input.endDate && (!input.startDate || flow.date >= input.startDate))
    .map((flow) => ({ id: flow.id, taskId: task.key, date: flow.date, kind: flow.kind, amount: flow.amount })));
  return {
    startDate: start?.date ?? null,
    endDate: end?.date ?? null,
    totalChange,
    totalChangeRate: start && totalChange !== null && start.totalAmount !== 0
      ? round2((totalChange / Math.abs(start.totalAmount)) * 100)
      : null,
    channels,
    classificationEvents,
    reports: reports.map((report) => ({ id: report.id, title: report.title, endDate: report.endDate })),
    financeTasks: financeTasks.map((task) => ({
      id: task.key,
      title: task.title ?? task.key,
      snapshotAsOf: task.snapshotAsOf,
      kind: task.taskKind ?? 'monthly-review',
    })),
    cashFlows,
    interpretation: cashFlows.length
      ? '存在有凭据的现金流记录；资产变化仍需结合估值和交易证据解释。'
      : '仅能确认历史资产余额变化；没有足够的现金流或交易证据，不能解释为净投入或投资收益。',
  };
}

export interface ObservationComparison {
  fromDate: string;
  toDate: string;
  fromValue: Money;
  toValue: Money;
  change: Money;
  changeRate: number | null;
  channels: Array<{
    id: string;
    name: string;
    from: Money | null;
    to: Money | null;
    change: Money | null;
    comparable: boolean;
  }>;
  comparable: boolean;
  warnings: string[];
}

/** Compare two exact, user-selected observations. Missing dates are never replaced by nearest points. */
export function compareHistoryObservations(
  history: readonly HistoryPoint[],
  fromDate: string,
  toDate: string,
): ObservationComparison {
  if (!fromDate || !toDate || fromDate >= toDate) throw new Error('请选择两个不同日期，并先选较早观察点');
  const byDate = new Map(validHistory(history).map((point) => [point.date, point]));
  const from = byDate.get(fromDate);
  const to = byDate.get(toDate);
  if (!from) throw new Error(`${fromDate} 没有真实观察点，不能补点比较`);
  if (!to) throw new Error(`${toDate} 没有真实观察点，不能补点比较`);
  const fromMap = from.channels?.length ? extractComposition(from.channels, 'parent', null)?.items ?? [] : [];
  const toMap = to.channels?.length ? extractComposition(to.channels, 'parent', null)?.items ?? [] : [];
  const fromById = new Map(fromMap.map((item) => [item.id, item]));
  const toById = new Map(toMap.map((item) => [item.id, item]));
  const ids = new Set([...fromById.keys(), ...toById.keys()]);
  const channels = [...ids].map((id) => {
    const before = fromById.get(id);
    const after = toById.get(id);
    const comparable = before !== undefined && after !== undefined;
    return {
      id,
      name: after?.recordedName ?? before?.recordedName ?? id,
      from: before?.amount ?? null,
      to: after?.amount ?? null,
      change: comparable ? diffMoney(after!.amount, before!.amount) : null,
      comparable,
    };
  }).sort((a, b) => Number(b.comparable) - Number(a.comparable)
    || Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  const warnings: string[] = [];
  if (!from.channels?.length) warnings.push(`${from.date} 缺少渠道快照，只能比较总资产`);
  if (!to.channels?.length) warnings.push(`${to.date} 缺少渠道快照，只能比较总资产`);
  if (channels.some((channel) => !channel.comparable)) warnings.push('部分渠道在任一日期缺少快照，渠道差额标为不可比较');
  const change = diffMoney(to.totalAmount, from.totalAmount);
  return {
    fromDate: from.date,
    toDate: to.date,
    fromValue: from.totalAmount,
    toValue: to.totalAmount,
    change,
    changeRate: from.totalAmount === 0 ? null : round2((change / Math.abs(from.totalAmount)) * 100),
    channels,
    comparable: Boolean(from.channels?.length && to.channels?.length && !channels.some((channel) => !channel.comparable)),
    warnings,
  };
}

export function downsamplePreservingExtremes(points: readonly AssetTrendPoint[], maxPoints = 1_000): AssetTrendPoint[] {
  if (points.length <= maxPoints || maxPoints < 8) return [...points];
  const bucketSize = Math.ceil(points.length / Math.max(1, Math.floor(maxPoints / 2)));
  const result: AssetTrendPoint[] = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    const valued = bucket.filter((point): point is AssetTrendPoint & { value: number } => point.value !== null);
    if (!valued.length) {
      result.push(bucket.find((point) => point.value === null) ?? bucket[0]!);
      continue;
    }
    const min = valued.reduce((best, point) => point.value < best.value ? point : best, valued[0]!);
    const max = valued.reduce((best, point) => point.value > best.value ? point : best, valued[0]!);
    const gap = bucket.find((point) => point.value === null);
    result.push(...[gap, min, max]
      .filter((point): point is AssetTrendPoint => Boolean(point))
      .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart)));
  }
  return result.filter((point, index) => index === 0 || point.bucketStart !== result[index - 1]?.bucketStart);
}

export function currentClassificationSnapshot(
  state: AssetClassificationState,
  channelId: string,
): ClassificationSnapshot | null {
  return classificationForChannel(state, channelId);
}
