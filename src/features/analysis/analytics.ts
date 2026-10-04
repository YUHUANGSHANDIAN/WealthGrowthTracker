import type { Channel, HistoryPoint } from '../../types';
import { channelAmount, leafChannels, totalAssets } from '../../utils/channels';
import { round2, diffMoney } from '../../utils/money';
import { addDays, todayString, weekStart, monthStart, yearStart } from '../../utils/date';
import { assetAtDate } from '../reports/generate';

/** 分析 KPI（注意：变化率是资产变化率，不是证券回报率）。 */
export interface AnalyticsKpis {
  currentTotal: number;
  startTotal: number;
  change: number;
  changeRate: number; // %
  max: number;
  min: number;
  avg: number;
  coverage: number; // 0-1 数据覆盖率
  pointCount: number;
}

export function analyticsKpis(history: HistoryPoint[], channels: Channel[], startDate: string | null): AnalyticsKpis {
  const currentTotal = totalAssets(channels);
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const inRange = startDate ? sorted.filter((p) => p.date >= startDate) : sorted;
  const amounts = inRange.map((p) => p.totalAmount);
  const startTotal = startDate ? assetAtDate(history, startDate) : (amounts.length ? amounts[0]! : currentTotal);
  const change = diffMoney(currentTotal, startTotal);
  const changeRate = startTotal > 0 ? round2((change / startTotal) * 100) : 0;
  const max = amounts.length ? Math.max(...amounts) : currentTotal;
  const min = amounts.length ? Math.min(...amounts) : currentTotal;
  const avg = amounts.length ? round2(amounts.reduce((a, b) => a + b, 0) / amounts.length) : currentTotal;

  let coverage = 1;
  if (startDate) {
    const span = Math.max(1, Math.round((Date.parse(todayString()) - Date.parse(startDate)) / 86_400_000));
    coverage = Math.min(1, amounts.length / Math.max(1, span + 1));
  }

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

export function periodComparison(history: HistoryPoint[]): PeriodComparison {
  const today = todayString();
  const now = assetAtDate(history, today);
  const calc = (prevStart: string): { change: number; rate: number } | null => {
    const prev = assetAtDate(history, prevStart);
    if (prev <= 0) return null;
    return { change: diffMoney(now, prev), rate: round2(((now - prev) / prev) * 100) };
  };
  return {
    wow: calc(weekStart(addDays(today, -7))),
    mom: calc(monthStart(addDays(today, -30))),
    yoy: calc(yearStart(addDays(today, -365))),
  };
}

/** 渠道变化（7/30/90/365 天，基于历史快照）。过去值为 0 → 显示「从 0 新增」。 */
export interface ChannelChangeItem {
  id: string;
  name: string;
  emoji: string;
  amount: number;
  change: number;
  changeRate: number | null; // null = 过去为 0
}

export function channelChange(history: HistoryPoint[], channels: Channel[], days: number): ChannelChangeItem[] {
  const today = todayString();
  const cutoff = addDays(today, -days);
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
      change: change ?? leaf.amount,
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
  channels: { name: string; amount: number }[];
}

export function historicalChannelComposition(history: HistoryPoint[], topN = 5): CompositionPoint[] {
  return history
    .filter((p) => p.channels && p.channels.length > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((p) => {
      const leaves = leafChannels(p.channels!).sort((a, b) => b.amount - a.amount);
      const top = leaves.slice(0, topN).map((l) => ({ name: l.name, amount: l.amount }));
      const rest = leaves.slice(topN).reduce((a, l) => a + l.amount, 0);
      const list = rest > 0 ? [...top, { name: '其他', amount: round2(rest) }] : top;
      return { date: p.date, channels: list };
    });
}
