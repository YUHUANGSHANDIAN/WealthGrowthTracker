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

/** 扁平化可比较的明细项；直接金额仍明确标记为父渠道未细分金额。 */
export interface LeafChannel {
  id: string;
  name: string;
  emoji: string;
  amount: number;
  parentId: string | null;
  parentName: string | null;
  kind: 'subchannel' | 'parent-direct';
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
          kind: 'subchannel',
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
        kind: 'parent-direct',
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

// ---------------------------------------------------------------------------
// 父渠道 ⇄ 子渠道 结构转换（v1.5，纯函数，保证资产守恒）
// ---------------------------------------------------------------------------

/** 添加首个子渠道时的金额处理策略。 */
export type FirstChildStrategy = 'direct' | 'transfer' | 'uncategorized' | 'clear';

/** 删除最后一个子渠道时的金额处理策略。 */
export type LastChildStrategy = 'keep-direct' | 'drop-amount';

export interface PromoteResult {
  channels: Channel[];
  /** 实际新增的子渠道（含策略生成的「未分类」）。 */
  addedChildren: SubChannel[];
  /** 结构转换导致的资产减少（transfer/uncategorized/direct 为 0，clear 为父渠道直接金额）。 */
  lostAmount: number;
}

/**
 * 给父渠道添加一个子渠道，并根据策略处理「父渠道已有直接金额」的语义转换。
 * - parent 已有子渠道，或直接金额为 0：等价于普通 addChildChannel（子渠道金额 0）。
 * - parent 无子渠道且直接金额 > 0：
 *   - transfer       ：直接金额转入新建子渠道（资产守恒）。
 *   - uncategorized  ：新建「未分类」子渠道承接直接金额，再新增用户子渠道（金额 0，资产守恒）。
 *   - clear          ：清空父渠道直接金额（仅用户二次确认后允许，总资产减少）。
 *   - direct         ：仅新增子渠道（金额 0），父渠道直接金额被结构转换丢弃（不推荐，测试用）。
 */
export function promoteParentToChildren(
  channels: Channel[],
  parentId: string,
  child: SubChannel,
  strategy: FirstChildStrategy,
): PromoteResult {
  const parent = channels.find((c) => c.id === parentId);
  if (!parent || !parent.isParent) return { channels, addedChildren: [], lostAmount: 0 };

  const hasChildren = (parent.children?.length ?? 0) > 0;
  const directAmount = hasChildren ? 0 : round2(parent.amount);

  let added: SubChannel[] = [];
  let lostAmount = 0;

  if (!hasChildren && directAmount > 0) {
    switch (strategy) {
      case 'transfer':
        added = [{ ...child, amount: directAmount }];
        break;
      case 'uncategorized': {
        const uncat: SubChannel = {
          id: randomId('sub'),
          name: '未分类',
          emoji: '🗂️',
          amount: directAmount,
          color: child.color,
          parentId,
        };
        added = [uncat, { ...child, amount: 0 }];
        break;
      }
      case 'clear':
        added = [{ ...child, amount: 0 }];
        lostAmount = directAmount;
        break;
      case 'direct':
      default:
        added = [{ ...child, amount: 0 }];
        break;
    }
  } else {
    added = [{ ...child, amount: 0 }];
  }

  const next = normalizeChannelAmounts(
    channels.map((c) =>
      c.id === parentId
        ? { ...c, children: [...(c.children ?? []), ...added], isExpanded: true, updatedAt: nowIso() }
        : c,
    ),
  );
  return { channels: next, addedChildren: added, lostAmount };
}

export interface CollapseResult {
  channels: Channel[];
  /** 保留为父渠道直接金额的金额。 */
  keptAmount: number;
  /** 结构转换导致的资产减少。 */
  lostAmount: number;
}

/**
 * 删除子渠道，并显式处理「删除最后一个子渠道」的金额语义。
 * - 非最后一个子渠道：普通删除，父渠道仍由剩余子渠道汇总（资产守恒）。
 * - 最后一个子渠道且 amount > 0：
 *   - keep-direct ：父渠道变为直接持有该金额（资产守恒，推荐）。
 *   - drop-amount ：同时删除该金额（总资产减少，需用户明确确认）。
 * - 最后一个子渠道且 amount = 0：两种策略等价，父渠道变为空直接渠道。
 */
export function collapseParentToDirectAmount(
  channels: Channel[],
  parentId: string,
  childId: string,
  strategy: LastChildStrategy,
): CollapseResult {
  const parent = channels.find((c) => c.id === parentId);
  if (!parent) return { channels, keptAmount: 0, lostAmount: 0 };
  const children = parent.children ?? [];
  const target = children.find((s) => s.id === childId);
  if (!target) return { channels, keptAmount: 0, lostAmount: 0 };

  const remaining = children.filter((s) => s.id !== childId);
  const targetAmount = round2(target.amount);

  if (remaining.length > 0) {
    return {
      channels: normalizeChannelAmounts(
        channels.map((c) => (c.id === parentId ? { ...c, children: remaining, updatedAt: nowIso() } : c)),
      ),
      keptAmount: 0,
      lostAmount: 0,
    };
  }

  if (strategy === 'drop-amount' && targetAmount > 0) {
    const next = channels.map((c) =>
      c.id === parentId ? { ...c, children: [], amount: 0, updatedAt: nowIso() } : c,
    );
    return { channels: next, keptAmount: 0, lostAmount: targetAmount };
  }

  // keep-direct（或 amount = 0 时等价）：父渠道变为直接持有该金额
  const next = channels.map((c) =>
    c.id === parentId ? { ...c, children: [], amount: targetAmount, updatedAt: nowIso() } : c,
  );
  return { channels: next, keptAmount: targetAmount, lostAmount: 0 };
}

/**
 * 设置明细金额：无子渠道的父渠道直接设置未细分金额；有子渠道的父渠道设置其指定子渠道金额。
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
