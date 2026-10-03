import type { Channel, CustomSortRule, SubChannel } from '../types';
import { round2, sumMoney } from './money';
import { randomId } from './id';

/** 单个渠道的有效金额：父渠道 = 子渠道金额之和；无子渠道的父渠道/子渠道 = 自身金额。 */
export function channelAmount(channel: Channel): number {
  if (channel.isParent && channel.children && channel.children.length > 0) {
    return sumMoney(channel.children.map((c) => c.amount));
  }
  return channel.amount;
}

/** 总资产 = 所有渠道有效金额之和。 */
export function totalAssets(channels: Channel[]): number {
  return sumMoney(channels.map((c) => channelAmount(c)));
}

/** 计算渠道金额（父渠道金额 = 子渠道求和，写回父渠道 amount，保持与展示一致）。 */
export function normalizeChannelAmounts(channels: Channel[]): Channel[] {
  return channels.map((c) =>
    c.isParent && c.children && c.children.length > 0
      ? { ...c, amount: sumMoney(c.children.map((s) => s.amount)) }
      : c,
  );
}

/** 扁平化所有「叶子」渠道（含无子渠道的父渠道），用于对比/报告等。 */
export interface LeafChannel {
  id: string;
  name: string;
  emoji: string;
  amount: number;
  parentId: string | null;
  parentName: string | null;
}

export function leafChannels(channels: Channel[]): LeafChannel[] {
  const leaves: LeafChannel[] = [];
  for (const c of channels) {
    if (c.isParent && c.children && c.children.length > 0) {
      for (const s of c.children) {
        leaves.push({
          id: s.id,
          name: s.name,
          emoji: s.emoji,
          amount: s.amount,
          parentId: c.id,
          parentName: c.name,
        });
      }
    } else {
      leaves.push({
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        amount: c.amount,
        parentId: null,
        parentName: null,
      });
    }
  }
  return leaves;
}

/** 默认排序：父渠道按有效金额降序；子渠道按金额降序。 */
export function sortChannels(channels: Channel[]): Channel[] {
  return channels
    .map((c) => {
      if (c.isParent && c.children && c.children.length > 0) {
        return {
          ...c,
          children: [...c.children].sort((a, b) => b.amount - a.amount),
        };
      }
      return c;
    })
    .sort((a, b) => channelAmount(b) - channelAmount(a));
}

// ---------------------------------------------------------------------------
// 渠道 CRUD（纯函数，返回新数组，不改原数组）
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

/** 新建一个父渠道。 */
export function addChannel(channels: Channel[], channel: Channel): Channel[] {
  return [...channels, channel];
}

/** 更新父渠道的可编辑字段（name/emoji/color），自动打 updatedAt。 */
export function updateChannel(
  channels: Channel[],
  id: string,
  patch: Partial<Pick<Channel, 'name' | 'emoji' | 'color'>>,
): Channel[] {
  return channels.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c));
}

/** 删除父渠道（含其全部子渠道）。 */
export function removeChannel(channels: Channel[], id: string): Channel[] {
  return channels.filter((c) => c.id !== id);
}

/** 展开/收起父渠道。 */
export function toggleChannelExpanded(channels: Channel[], id: string): Channel[] {
  return channels.map((c) => (c.id === id ? { ...c, isExpanded: !c.isExpanded } : c));
}

/** 给父渠道添加子渠道。 */
export function addChildChannel(
  channels: Channel[],
  parentId: string,
  child: SubChannel,
): Channel[] {
  return normalizeChannelAmounts(
    channels.map((c) =>
      c.id === parentId && c.isParent
        ? {
            ...c,
            children: [...(c.children ?? []), child],
            isExpanded: true,
            updatedAt: nowIso(),
          }
        : c,
    ),
  );
}

/** 更新子渠道的金额。 */
export function updateChildAmount(
  channels: Channel[],
  parentId: string,
  childId: string,
  amount: number,
): Channel[] {
  return normalizeChannelAmounts(
    channels.map((c) =>
      c.id === parentId && c.isParent && c.children
        ? {
            ...c,
            children: c.children.map((s) =>
              s.id === childId ? { ...s, amount: round2(amount) } : s,
            ),
            updatedAt: nowIso(),
          }
        : c,
    ),
  );
}

/** 更新子渠道的可编辑字段（name/emoji/color）。 */
export function updateSubChannel(
  channels: Channel[],
  parentId: string,
  childId: string,
  patch: Partial<Pick<SubChannel, 'name' | 'emoji' | 'color'>>,
): Channel[] {
  return channels.map((c) =>
    c.id === parentId && c.isParent && c.children
      ? {
          ...c,
          children: c.children.map((s) => (s.id === childId ? { ...s, ...patch } : s)),
          updatedAt: nowIso(),
        }
      : c,
  );
}

/** 删除子渠道。 */
export function removeChildChannel(
  channels: Channel[],
  parentId: string,
  childId: string,
): Channel[] {
  return normalizeChannelAmounts(
    channels.map((c) =>
      c.id === parentId && c.isParent && c.children
        ? { ...c, children: c.children.filter((s) => s.id !== childId), updatedAt: nowIso() }
        : c,
    ),
  );
}

/**
 * 设置「叶子」金额：无子渠道的父渠道直接设置自身金额；有子渠道的父渠道设置其指定子渠道金额。
 * 统一入口，供金额编辑表单使用。
 */
export function setLeafAmount(
  channels: Channel[],
  target: { parentId: string; childId?: string },
  amount: number,
): Channel[] {
  const parent = channels.find((c) => c.id === target.parentId);
  if (!parent) return channels;
  const hasChildren = parent.isParent && parent.children && parent.children.length > 0;
  if (hasChildren) {
    if (!target.childId) return channels;
    return updateChildAmount(channels, target.parentId, target.childId, amount);
  }
  return channels.map((c) =>
    c.id === target.parentId ? { ...c, amount: round2(amount), updatedAt: nowIso() } : c,
  );
}

/** 便捷：新建子渠道对象。 */
export function makeSubChannel(
  parentId: string,
  name: string,
  emoji: string,
  color: string,
): SubChannel {
  return { id: randomId('sub'), name, emoji, amount: 0, color, parentId };
}

/** 便捷：新建父渠道对象。 */
export function makeChannel(
  name: string,
  emoji: string,
  color: string,
  opts: { isParent?: boolean } = {},
): Channel {
  const now = nowIso();
  return {
    id: randomId('channel'),
    name,
    emoji,
    amount: 0,
    color,
    isParent: opts.isParent ?? true,
    isExpanded: false,
    children: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------

export interface ChannelSortContext {
  totalAmount: number;
  /** 每个渠道 id 的增长（变化）率，用于 growth 字段排序。 */
  growthByChannel?: Map<string, number>;
}

function compareByRule(
  a: Channel,
  b: Channel,
  rule: CustomSortRule,
  ctx: ChannelSortContext,
): number {
  const dir = rule.direction === 'asc' ? 1 : -1;
  let va = 0;
  let vb = 0;
  let na = '';
  let nb = '';
  switch (rule.field) {
    case 'name':
      na = a.name;
      nb = b.name;
      return dir * na.localeCompare(nb, 'zh');
    case 'children':
      va = (a.children?.length ?? 0);
      vb = (b.children?.length ?? 0);
      break;
    case 'updatedAt':
      va = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      vb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      break;
    case 'growth': {
      const g = ctx.growthByChannel ?? new Map();
      va = g.get(a.id) ?? 0;
      vb = g.get(b.id) ?? 0;
      break;
    }
    case 'percentage':
      va = ctx.totalAmount > 0 ? channelAmount(a) / ctx.totalAmount : 0;
      vb = ctx.totalAmount > 0 ? channelAmount(b) / ctx.totalAmount : 0;
      break;
    case 'amount':
    default:
      va = channelAmount(a);
      vb = channelAmount(b);
      break;
  }
  if (va === vb) return 0;
  return dir * (va > vb ? 1 : -1);
}

/** 按单条规则排序父渠道（稳定排序）。 */
export function sortChannelsByRule(
  channels: Channel[],
  rule: CustomSortRule,
  ctx: ChannelSortContext,
): Channel[] {
  const indexed = channels.map((c, i) => ({ c, i }));
  indexed.sort((x, y) => compareByRule(x.c, y.c, rule, ctx) || x.i - y.i);
  return indexed.map((x) => x.c);
}

/** 多维排序：依次应用多条规则（后者作为前者相等时的次级键，稳定排序）。 */
export function sortChannelsMulti(
  channels: Channel[],
  rules: CustomSortRule[],
  ctx: ChannelSortContext,
): Channel[] {
  const indexed = channels.map((c, i) => ({ c, i }));
  indexed.sort((x, y) => {
    for (const rule of rules) {
      const d = compareByRule(x.c, y.c, rule, ctx);
      if (d !== 0) return d;
    }
    return x.i - y.i;
  });
  return indexed.map((x) => x.c);
}
