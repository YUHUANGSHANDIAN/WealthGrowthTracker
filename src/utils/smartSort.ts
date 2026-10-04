import type { Channel, ChannelGrowth, HistoryPoint, SmartSortConfig } from '../types';
import { channelAmount } from './channels';
import { addDays, todayString } from './date';

/** 在历史快照中查找叶子渠道（子渠道或无子渠道的父渠道）的金额。 */
function amountInSnapshot(snapshot: Channel[], id: string): number | null {
  for (const c of snapshot) {
    if (c.id === id) return channelAmount(c);
    if (c.children) {
      const sub = c.children.find((s) => s.id === id);
      if (sub) return sub.amount;
    }
  }
  return null;
}

function latestAtOrBefore(history: HistoryPoint[], date: string): HistoryPoint | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  let candidate: HistoryPoint | null = null;
  for (const p of sorted) {
    if (p.date <= date) candidate = p;
    else break;
  }
  return candidate ?? sorted[0]!;
}

const WINDOWS = [7, 30, 90, 365] as const;

/**
 * 计算每个叶子渠道在 7/30/90/365 天的增长（基于历史 channels 快照）。
 * 旧历史无快照时返回 null（不把缺失当 0%）。
 */
export function computeChannelGrowths(history: HistoryPoint[], channels: Channel[]): Map<string, ChannelGrowth> {
  const result = new Map<string, ChannelGrowth>();
  const today = todayString();

  const leaves: { id: string; amount: number }[] = [];
  for (const c of channels) {
    if (c.children && c.children.length > 0) {
      for (const s of c.children) leaves.push({ id: s.id, amount: s.amount });
    } else {
      leaves.push({ id: c.id, amount: c.amount });
    }
  }

  for (const leaf of leaves) {
    const g: ChannelGrowth = { id: leaf.id, g7d: null, g30d: null, g90d: null, g365d: null };
    for (const days of WINDOWS) {
      const point = latestAtOrBefore(history, addDays(today, -days));
      if (point?.channels && point.channels.length > 0) {
        const past = amountInSnapshot(point.channels, leaf.id);
        if (past !== null && past > 0) {
          const value = (leaf.amount - past) / past;
          g[`g${days}d`] = value;
        }
      }
    }
    result.set(leaf.id, g);
  }
  return result;
}

/** 某个父渠道（含其子渠道）在指定时间范围的增长率摘要；无快照返回 null。 */
export function channelGrowthFor(
  channel: Channel,
  growths: Map<string, ChannelGrowth>,
  window: '7d' | '30d' | '90d' | '365d' = '30d',
): number | null {
  const ids = channel.children && channel.children.length > 0 ? channel.children.map((s) => s.id) : [channel.id];
  const key = window === '7d' ? 'g7d' : window === '90d' ? 'g90d' : window === '365d' ? 'g365d' : 'g30d';
  const values = ids.map((id) => growths.get(id)?.[key]).filter((v): v is number => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 兼容旧调用：30 日增长率摘要。 */
export function channelGrowth30d(channel: Channel, growths: Map<string, ChannelGrowth>): number | null {
  return channelGrowthFor(channel, growths, '30d');
}

export interface SmartScoreBreakdown {
  amountShare: number; // 0-100
  growth: number; // 0-100（无数据时 50 中性）
  activity: number; // 0-100
  recency: number; // 0-100
  score: number; // 0-100
}

export const DEFAULT_SMART_CONFIG: SmartSortConfig = {
  amountWeight: 40,
  growthWeight: 30,
  activityWeight: 20,
  updatedAtWeight: 10,
  preset: 'balanced',
  timeRange: '30d',
};

/** 计算父渠道的综合评分（本地评分算法，非 AI），含可解释分解。 */
export function computeSmartScore(
  channel: Channel,
  growths: Map<string, ChannelGrowth>,
  totalAmount: number,
  config: SmartSortConfig = DEFAULT_SMART_CONFIG,
): SmartScoreBreakdown {
  const amount = channelAmount(channel);
  const amountShare = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;

  const g = channelGrowthFor(channel, growths, config.timeRange ?? '30d');
  // 增长率映射到 0-100：+20% 及以上 → 100，-20% 及以下 → 0；无数据 → 50（中性）
  const growth = g === null ? 50 : Math.max(0, Math.min(100, ((g + 0.2) / 0.4) * 100));

  const hasChildren = (channel.children?.length ?? 0) > 0;
  const activity = Math.max(0, Math.min(100, amount * 0.02 + (hasChildren ? 20 : 10)));

  const updatedAt = channel.updatedAt ? new Date(channel.updatedAt).getTime() : 0;
  const ageDays = (Date.now() - updatedAt) / 86_400_000;
  const recency = updatedAt === 0 ? 0 : Math.max(0, Math.min(100, 100 - ageDays * 5));

  const totalW = config.amountWeight + config.growthWeight + config.activityWeight + config.updatedAtWeight || 1;
  const score =
    (amountShare * config.amountWeight + growth * config.growthWeight + activity * config.activityWeight + recency * config.updatedAtWeight) / totalW;

  return { amountShare, growth, activity, recency, score: Math.round(score * 10) / 10 };
}

/** 智能综合排序（本地评分），未固定（pinned）渠道置顶。 */
export function sortChannelsSmart(
  channels: Channel[],
  growths: Map<string, ChannelGrowth>,
  totalAmount: number,
  pinnedIds: Set<string> = new Set(),
  config: SmartSortConfig = DEFAULT_SMART_CONFIG,
): { id: string; score: SmartScoreBreakdown }[] {
  const scored = channels.map((c) => ({ id: c.id, score: computeSmartScore(c, growths, totalAmount, config) }));
  scored.sort((a, b) => {
    const pa = pinnedIds.has(a.id) ? 1 : 0;
    const pb = pinnedIds.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa; // 固定优先
    return b.score.score - a.score.score;
  });
  return scored;
}
