import type { Channel, HistoryPoint } from '../../types';
import { channelAmount, leafChannels, totalAssets } from '../../utils/channels';
import { round2, diffMoney } from '../../utils/money';
import { addDays, todayString } from '../../utils/date';
import { assetAtDate } from '../reports/generate';

/** 分析 KPI（注意：变化率是资产变化率，不是证券回报率）。 */
export interface AnalyticsKpis {
  currentTotal: number | null;
  startTotal: number | null;
  change: number | null;
  changeRate: number | null; // %
  max: number | null;
  min: number | null;
  avg: number | null;
  coverage: number; // 0-1 数据覆盖率
  pointCount: number;
}

export function analyticsKpis(history: HistoryPoint[], channels: Channel[], startDate: string | null, endDate = todayString()): AnalyticsKpis {
  const sorted = [...history].filter(p => Number.isFinite(p.totalAmount)).sort((a, b) => a.date.localeCompare(b.date));
  const inRange = sorted.filter(p => (!startDate || p.date >= startDate) && p.date <= endDate);
  const amounts = inRange.map(p => p.totalAmount);
  const currentTotal = endDate === todayString() ? totalAssets(channels) : assetAtDate(sorted, endDate);
  const startTotal = startDate ? assetAtDate(sorted, startDate) : (amounts[0] ?? null);
  const change = currentTotal === null || startTotal === null ? null : diffMoney(currentTotal, startTotal);
  const changeRate = change === null || startTotal === null || startTotal === 0 ? null : round2(change / Math.abs(startTotal) * 100);
  const max = amounts.length ? Math.max(...amounts) : null;
  const min = amounts.length ? Math.min(...amounts) : null;
  const avg = amounts.length ? round2(amounts.reduce((a, b) => a + b, 0) / amounts.length) : null;
  const first = startDate ?? inRange[0]?.date;
  const span = first ? Math.max(1, Math.round((Date.parse(endDate) - Date.parse(first)) / 86_400_000) + 1) : 1;
  const coverage = Math.min(1, new Set(inRange.map(p => p.date)).size / span);
  return { currentTotal, startTotal, change, changeRate, max, min, avg, coverage, pointCount: amounts.length };
}

/** 资产集中度（仅描述资产在记录渠道中的集中程度，不等于投资风险）。 */
export interface Concentration {
  top1: number; // %
  top3: number; // %
  hhi: number; // 0-10000
}

export function assetConcentration(channels: Channel[]): Concentration {
  const leaves = leafChannels(channels).map((l) => l.amount);
  const total = leaves.reduce((a, b) => a + b, 0);
  if (total <= 0) return { top1: 0, top3: 0, hhi: 0 };
  const shares = leaves.map((v) => (v / total) * 100).sort((a, b) => b - a);
  const top1 = round2(shares[0] ?? 0);
  const top3 = round2(shares.slice(0, 3).reduce((a, b) => a + b, 0));
  const hhi = round2(shares.reduce((a, s) => a + s * s, 0));
  return { top1, top3, hhi };
}

/** 环比 / 同比比较。 */
export interface PeriodComparison {
  wow: { change: number; rate: number } | null;
  mom: { change: number; rate: number } | null;
  yoy: { change: number; rate: number } | null;
}

/** Compare matching calendar dates, clamping leap days and short months. */
export function calendarOffset(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day!, last));
  return target.toISOString().slice(0, 10);
}

export function periodComparison(history: HistoryPoint[], endDate = todayString()): PeriodComparison {
  const now = assetAtDate(history, endDate);
  const calc = (date: string): { change: number; rate: number } | null => {
    const prev = assetAtDate(history, date);
    if (now === null || prev === null || prev === 0) return null;
    return { change: diffMoney(now, prev), rate: round2((now - prev) / Math.abs(prev) * 100) };
  };
  return { wow: calc(addDays(endDate, -7)), mom: calc(calendarOffset(endDate, -1)), yoy: calc(calendarOffset(endDate, -12)) };
}

/** 渠道变化（7/30/90/365 天，基于历史快照）。过去值为 0 → 显示「从 0 新增」。 */
export interface ChannelChangeItem {
  id: string;
  name: string;
  emoji: string;
  amount: number;
  change: number | null;
  changeRate: number | null; // null = 过去为 0
}

export function channelChange(history: HistoryPoint[], channels: Channel[], days: number, endDate = todayString(), startDate?: string): ChannelChangeItem[] {
  const cutoff = startDate ?? addDays(endDate, -days);
  const filtered = history.filter((p) => p.date <= cutoff).sort((a, b) => (a.date < b.date ? -1 : 1));
  const pastPoint = filtered.length ? filtered[filtered.length - 1] : undefined;

  const out: ChannelChangeItem[] = [];
  for (const leaf of leafChannels(channels)) {
    let past: number | null = null;
    if (pastPoint?.channels && pastPoint.channels.length > 0) {
      past = amountInSnapshot(pastPoint.channels, leaf.id);
    }
    const change = past === null ? null : diffMoney(leaf.amount, past);
    out.push({
      id: leaf.id,
      name: leaf.parentName ? `${leaf.parentName} · ${leaf.name}` : leaf.name,
      emoji: leaf.emoji,
      amount: leaf.amount,
      change,
      changeRate: change === null ? null : past! > 0 ? round2(((leaf.amount - past!) / past!) * 100) : null,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function amountInSnapshot(channels: Channel[], id: string): number | null {
  for (const c of channels) {
    if (c.id === id) return channelAmount(c);
    if (c.children) {
      const sub = c.children.find((s) => s.id === id);
      if (sub) return sub.amount;
    }
  }
  return null;
}

/** 历史渠道构成（从 HistoryPoint.channels 快照提取，缺快照的点跳过）。 */
export interface CompositionPoint {
  date: string;
  channels: { id: string; name: string; amount: number }[];
  /** 该日期是否缺少渠道快照。 */
  missing: boolean;
}

export interface CompositionOptions {
  level: 'parent' | 'leaf';
  topN: number;
  mode: 'absolute' | 'percent';
}

/** 父渠道聚合：把子渠道金额汇总到父渠道（无子渠道的父渠道保留自身）。 */
function parentChannels(channels: Channel[]): CompositionPoint['channels'] {
  return channels.map(c => ({ id: `parent:${c.id}`, name: c.name, amount: round2(channelAmount(c)) }));
}

/** 期初 → 期末结构变化（父渠道 rollup）。只做描述性统计，不写投资建议。 */
export interface StructureChangeItem {
  id: string;
  name: string;
  emoji: string;
  startAmount: number;
  endAmount: number;
  amountChange: number;
  startPct: number; // 期初占比 %
  endPct: number; // 期末占比 %
  pctChange: number; // 占比变化（百分点）
}

/** 把两个渠道快照按父渠道聚合，计算结构变化（缺期初快照时用 amount 0）。 */
export function channelStructureChange(startChannels: Channel[] | undefined, endChannels: Channel[]): StructureChangeItem[] {
  const aggregate = (channels: Channel[] | undefined): Map<string, { name: string; emoji: string; amount: number }> => {
    const map = new Map<string, { name: string; emoji: string; amount: number }>();
    if (!channels) return map;
    for (const c of channels) {
      const amount = channelAmount(c);
      const existing = map.get(c.id);
      if (existing) existing.amount = round2(existing.amount + amount);
      else map.set(c.id, { name: c.name, emoji: c.emoji, amount: round2(amount) });
    }
    return map;
  };

  const start = aggregate(startChannels);
  const end = aggregate(endChannels);
  const startTotal = [...start.values()].reduce((a, c) => a + c.amount, 0);
  const endTotal = [...end.values()].reduce((a, c) => a + c.amount, 0);

  const ids = new Set([...start.keys(), ...end.keys()]);
  const items: StructureChangeItem[] = [];
  for (const id of ids) {
    const s = start.get(id);
    const e = end.get(id);
    const startAmount = s?.amount ?? 0;
    const endAmount = e?.amount ?? 0;
    const name = e?.name ?? s?.name ?? id;
    const emoji = e?.emoji ?? s?.emoji ?? '💰';
    const startPct = startTotal > 0 ? round2((startAmount / startTotal) * 100) : 0;
    const endPct = endTotal > 0 ? round2((endAmount / endTotal) * 100) : 0;
    items.push({
      id,
      name,
      emoji,
      startAmount,
      endAmount,
      amountChange: diffMoney(endAmount, startAmount),
      startPct,
      endPct,
      pctChange: round2(endPct - startPct),
    });
  }
  return items.sort((a, b) => Math.abs(b.amountChange) - Math.abs(a.amountChange));
}

export function historicalChannelComposition(history: HistoryPoint[], opts: CompositionOptions = { level: 'leaf', topN: 5, mode: 'absolute' }): CompositionPoint[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const extract = (channels: Channel[]) => opts.level === 'parent' ? parentChannels(channels) : leafChannels(channels).map(l => ({
    id: `leaf:${l.id}`, name: l.parentName ? `${l.parentName} · ${l.name}` : l.name, amount: l.amount,
  }));
  const identities = new Map<string, { name: string; weight: number }>();
  for (const point of sorted) for (const item of extract(point.channels ?? [])) {
    const previous = identities.get(item.id);
    identities.set(item.id, { name: item.name, weight: (previous?.weight ?? 0) + Math.abs(item.amount) });
  }
  // Choose once over the selected interval; a curve's identity never changes per date.
  const topIds = [...identities].sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, opts.topN)).map(([id]) => id);
  const topSet = new Set(topIds);
  const duplicateNames = new Map<string, number>();
  for (const item of identities.values()) duplicateNames.set(item.name, (duplicateNames.get(item.name) ?? 0) + 1);
  return sorted.map((p) => {
    if (!p.channels || (opts.mode === 'percent' && p.totalAmount <= 0)) {
      return { date: p.date, channels: [], missing: true };
    }
    const base = extract(p.channels);
    const total = base.reduce((a, c) => a + c.amount, 0);
    const byId = new Map(base.map(c => [c.id, c.amount]));
    let list = topIds.map(id => {
      const name = identities.get(id)!.name;
      return { id, name: duplicateNames.get(name)! > 1 ? `${name} [${id}]` : name, amount: byId.get(id) ?? 0 };
    });
    if (identities.size > topIds.length) list.push({ id: 'aggregate:other', name: '其他', amount: round2(base.filter(c => !topSet.has(c.id)).reduce((sum, c) => sum + c.amount, 0)) });
    const unallocated = round2(p.totalAmount - total);
    if (unallocated !== 0) list.push({ id: 'aggregate:unallocated', name: '未分配差额', amount: unallocated });
    if (opts.mode === 'percent') {
      list = list.map(c => ({ ...c, amount: round2(c.amount / p.totalAmount * 100) }));
    }
    return { date: p.date, channels: list, missing: false };
  });
}
