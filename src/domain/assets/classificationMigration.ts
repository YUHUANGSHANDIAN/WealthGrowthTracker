import type { Channel, FinancialReport, HistoryPoint } from '../../types';
import type { MonthlyPlanningState } from '../portfolio/types';
import { channelAmount, totalAssets } from '../../utils/channels';
import { canonicalJson, sha256Text } from '../../utils/canonicalHash';
import {
  ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID,
  appendClassificationEvent,
  classifyFundHolding,
  createClassificationEvent,
  latestClassificationEvent,
  type AssetClassificationEvent,
  type AssetClassificationState,
  type ClassificationSnapshot,
  type ClassificationTarget,
} from './classification';

export interface ClassificationMigrationChange {
  kind: AssetClassificationEvent['kind'];
  target: ClassificationTarget;
  before: ClassificationSnapshot | null;
  after: ClassificationSnapshot;
  evidenceIds: string[];
  observedAt?: string;
  taskId?: string;
  holdingId?: string;
  reason: string;
}

export interface ClassificationMigrationPending {
  taskId: string;
  holdingId: string;
  reason: string;
}

export interface AlipayClassificationMigrationPlan {
  id: typeof ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID;
  status: 'ready' | 'applied' | 'blocked';
  generatedAt: string;
  changes: ClassificationMigrationChange[];
  pending: ClassificationMigrationPending[];
  blockers: string[];
  counts: {
    channelChanges: number;
    productDescriptors: number;
    holdingChanges: number;
    pending: number;
  };
  invariant: {
    totalBefore: number;
    totalAfter: number;
    totalDelta: number;
    channelAmountsStable: boolean;
    historyCount: number;
    reportCount: number;
    taskRevisionCount: number;
  };
}

function normalizedName(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function targetKey(target: ClassificationTarget): string {
  return `${target.type}:${target.taskId ?? ''}:${target.id}`;
}

function evidenceForHolding(
  planning: MonthlyPlanningState,
  taskId: string,
  holdingId: string,
): string[] {
  const task = planning.sessions.find((session) => session.key === taskId);
  if (!task) return [];
  const sourceIds = task.observations
    .filter((observation) => observation.holdingId === holdingId)
    .flatMap((observation) => observation.evidence.map((evidence) => evidence.sourceId));
  return [...new Set(sourceIds.length ? sourceIds : task.documents.map((document) => document.id))].sort();
}

function beforeHoldingSnapshot(holding: MonthlyPlanningState['sessions'][number]['holdings'][number]): ClassificationSnapshot {
  return {
    ...(holding.childChannelId ? { childChannelId: holding.childChannelId } : {}),
    productKind: holding.productType === 'fund' ? 'fund-other' : 'other',
    ...(holding.shareClass === 'A' || holding.shareClass === 'C' || holding.shareClass === 'other'
      ? { shareClass: holding.shareClass }
      : {}),
    exposureTags: [...holding.exposureTags].sort(),
    amountBasis: 'holding-observation',
  };
}

export function buildAlipayClassificationMigrationPlan(input: {
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  planning: MonthlyPlanningState;
  classifications: AssetClassificationState;
  now?: string;
}): AlipayClassificationMigrationPlan {
  const now = input.now ?? new Date().toISOString();
  const applied = input.classifications.migrations[ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID];
  const alipay = input.channels.find((channel) => channel.id === 'alipay');
  const gold = alipay?.children?.find((channel) => channel.id === 'alipay_gold');
  const blockers: string[] = [];
  const changes: ClassificationMigrationChange[] = [];
  const pending: ClassificationMigrationPending[] = [];

  if (!alipay) blockers.push('未找到支付宝父渠道');
  if (!gold) blockers.push('未找到支付宝稳定渠道 alipay_gold');

  if (applied?.status === 'applied') {
    return {
      id: ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID,
      status: 'applied',
      generatedAt: now,
      changes: [],
      pending: [],
      blockers,
      counts: { channelChanges: 0, productDescriptors: 0, holdingChanges: 0, pending: 0 },
      invariant: {
        totalBefore: totalAssets(input.channels),
        totalAfter: totalAssets(input.channels),
        totalDelta: 0,
        channelAmountsStable: true,
        historyCount: input.history.length,
        reportCount: input.reports.length,
        taskRevisionCount: input.planning.taskRevisions.length,
      },
    };
  }

  if (gold) {
    const channelTarget: ClassificationTarget = { type: 'channel', id: 'alipay_gold' };
    const currentChannel = latestClassificationEvent(input.classifications, channelTarget)?.after ?? null;
    const rename = normalizedName(gold.name) === normalizedName('黄金');
    const after: ClassificationSnapshot = {
      displayName: rename ? '银行黄金' : gold.name,
      productKind: 'bank-gold-accumulation',
      exposureTags: ['gold'],
      amountBasis: 'channel-total',
    };
    if (JSON.stringify(currentChannel) !== JSON.stringify(after)) {
      changes.push({
        kind: rename ? 'channel-rename' : 'product-classify',
        target: channelTarget,
        before: currentChannel ?? { displayName: gold.name, productKind: 'other', exposureTags: [], amountBasis: 'channel-total' },
        after,
        evidenceIds: input.planning.sessions.flatMap((session) => session.documents.map((document) => document.id)),
        reason: '用户确认支付宝银行黄金当前内容为积存金；仅更新分类和显示语义，不修改渠道金额。',
      });
    }

    const productTarget: ClassificationTarget = {
      type: 'product',
      id: 'product:alipay_gold:bank-gold-accumulation',
    };
    const currentProduct = latestClassificationEvent(input.classifications, productTarget)?.after ?? null;
    const productAfter: ClassificationSnapshot = {
      displayName: '积存金',
      childChannelId: 'alipay_gold',
      productKind: 'bank-gold-accumulation',
      exposureTags: ['gold'],
      amountBasis: 'channel-total',
    };
    if (JSON.stringify(currentProduct) !== JSON.stringify(productAfter)) {
      changes.push({
        kind: 'product-classify',
        target: productTarget,
        before: currentProduct,
        after: productAfter,
        evidenceIds: input.planning.sessions.flatMap((session) => session.documents.map((document) => document.id)),
        reason: '积存金作为银行黄金渠道的产品描述，金额基准为渠道总额，不创建第二份资产。',
      });
    }
  }

  const keyedHoldings = new Map<string, Array<{ taskId: string; holdingId: string }>>();
  for (const task of input.planning.sessions) {
    for (const holding of task.holdings) {
      if (holding.productType !== 'fund') continue;
      if (holding.parentChannelId !== 'alipay' && !/黄金/.test(holding.originalName)) continue;
      const key = `${task.key}:${holding.parentChannelId}:${holding.fundCode ?? normalizedName(holding.originalName)}`;
      const items = keyedHoldings.get(key) ?? [];
      items.push({ taskId: task.key, holdingId: holding.id });
      keyedHoldings.set(key, items);
    }
  }
  const duplicateHoldingIds = new Set<string>();
  for (const items of keyedHoldings.values()) {
    if (items.length < 2) continue;
    for (const item of items) {
      duplicateHoldingIds.add(`${item.taskId}:${item.holdingId}`);
      pending.push({
        taskId: item.taskId,
        holdingId: item.holdingId,
        reason: '同一任务、同一父渠道下存在重复基金代码；保留全部 holdingId，等待人工核对',
      });
    }
  }

  for (const task of input.planning.sessions) {
    for (const holding of task.holdings) {
      if (holding.productType !== 'fund') continue;
      if (holding.parentChannelId !== 'alipay' && !/黄金/.test(holding.originalName)) continue;
      if (duplicateHoldingIds.has(`${task.key}:${holding.id}`)) continue;
      const target: ClassificationTarget = { type: 'holding', id: holding.id, taskId: task.key };
      const current = latestClassificationEvent(input.classifications, target)?.after ?? beforeHoldingSnapshot(holding);
      let after: ClassificationSnapshot;
      if (holding.parentChannelId === 'alipay') {
        const result = classifyFundHolding({
          name: holding.originalName,
          fundCode: holding.fundCode,
          shareClass: holding.shareClass,
          parentChannelId: holding.parentChannelId,
          childChannelId: holding.childChannelId,
          exposureTags: holding.exposureTags,
          productType: holding.productType,
        });
        if (result.confidence !== 'high') {
          pending.push({
            taskId: task.key,
            holdingId: holding.id,
            reason: result.issues.join('；') || '分类置信度不足',
          });
          continue;
        }
        after = {
          ...(result.childChannelId ? { childChannelId: result.childChannelId } : {}),
          productKind: result.productKind,
          ...(result.shareClass ? { shareClass: result.shareClass } : {}),
          exposureTags: result.exposureTags,
          amountBasis: result.amountBasis,
        };
      } else {
        after = {
          ...current,
          exposureTags: [...new Set([...current.exposureTags, 'gold'])].sort(),
          amountBasis: current.amountBasis ?? 'holding-observation',
        };
      }
      if (JSON.stringify(current) === JSON.stringify(after)) continue;
      changes.push({
        kind: 'holding-reclassify',
        target,
        before: current,
        after,
        evidenceIds: evidenceForHolding(input.planning, task.key, holding.id),
        observedAt: task.valuationAsOf ?? task.snapshotAsOf,
        taskId: task.key,
        holdingId: holding.id,
        reason: holding.parentChannelId === 'alipay'
          ? '用户确认支付宝基金分类；保留 holdingId 与金额，只更新产品、基金渠道和风险敞口。'
          : '仅补充已确认的黄金风险敞口，不改变其他平台渠道名称或金额。',
      });
    }
  }

  const uniqueChanges = new Map<string, ClassificationMigrationChange>();
  for (const change of changes) uniqueChanges.set(`${change.kind}:${targetKey(change.target)}`, change);
  const finalChanges = [...uniqueChanges.values()].sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)));
  const beforeAmounts = Object.fromEntries(
    input.channels.flatMap((channel) => [
      [channel.id, channelAmount(channel)],
      ...(channel.children ?? []).map((child) => [child.id, child.amount] as const),
    ]),
  );
  const afterAmounts = { ...beforeAmounts };
  const totalBefore = totalAssets(input.channels);
  const totalAfter = totalAssets(input.channels);
  return {
    id: ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID,
    status: blockers.length ? 'blocked' : 'ready',
    generatedAt: now,
    changes: finalChanges,
    pending: pending.sort((a, b) => `${a.taskId}:${a.holdingId}`.localeCompare(`${b.taskId}:${b.holdingId}`)),
    blockers,
    counts: {
      channelChanges: finalChanges.filter((change) => change.target.type === 'channel').length,
      productDescriptors: finalChanges.filter((change) => change.target.type === 'product').length,
      holdingChanges: finalChanges.filter((change) => change.target.type === 'holding').length,
      pending: pending.length,
    },
    invariant: {
      totalBefore,
      totalAfter,
      totalDelta: totalAfter - totalBefore,
      channelAmountsStable: Object.entries(beforeAmounts).every(([id, amount]) => afterAmounts[id] === amount),
      historyCount: input.history.length,
      reportCount: input.reports.length,
      taskRevisionCount: input.planning.taskRevisions.length,
    },
  };
}

export async function classificationMigrationPlanHash(plan: AlipayClassificationMigrationPlan): Promise<string> {
  return sha256Text(canonicalJson(plan));
}

export async function applyAlipayClassificationMigration(input: {
  plan: AlipayClassificationMigrationPlan;
  state: AssetClassificationState;
  backupSha256: string;
  classifiedAt?: string;
}): Promise<AssetClassificationState> {
  if (input.plan.status === 'applied') return input.state;
  if (input.plan.status !== 'ready') throw new Error(input.plan.blockers.join('；') || '分类迁移预览不可应用');
  if (input.plan.invariant.totalDelta !== 0 || !input.plan.invariant.channelAmountsStable) {
    throw new Error('分类迁移会改变渠道金额，已阻止应用');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.backupSha256)) throw new Error('升级前完整备份哈希无效');
  const classifiedAt = input.classifiedAt ?? new Date().toISOString();
  const dryRunSha256 = await classificationMigrationPlanHash(input.plan);
  const events: AssetClassificationEvent[] = [];
  for (const change of input.plan.changes) {
    events.push(await createClassificationEvent({
      kind: change.kind,
      target: change.target,
      before: change.before,
      after: change.after,
      source: 'user-confirmed',
      evidenceIds: change.evidenceIds,
      ...(change.observedAt ? { observedAt: change.observedAt } : {}),
      classifiedAt,
      migrationId: ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID,
      reason: change.reason,
    }));
  }
  let state = input.state;
  for (const event of events) state = appendClassificationEvent(state, event);
  return {
    ...state,
    migrations: {
      ...state.migrations,
      [ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID]: {
        id: ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID,
        status: 'applied',
        appliedAt: classifiedAt,
        backupSha256: input.backupSha256.toLowerCase(),
        dryRunSha256,
        appliedEventIds: events.map((event) => event.id),
      },
    },
  };
}

export async function revertAlipayClassificationMigration(input: {
  state: AssetClassificationState;
  at?: string;
}): Promise<AssetClassificationState> {
  const record = input.state.migrations[ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID];
  if (!record || record.status !== 'applied') throw new Error('没有可撤销的支付宝分类迁移');
  const at = input.at ?? new Date().toISOString();
  const originals = new Map(input.state.events.map((event) => [event.id, event]));
  let state = input.state;
  for (const eventId of record.appliedEventIds) {
    const original = originals.get(eventId);
    if (!original || original.kind === 'reversal') continue;
    const reversal = await createClassificationEvent({
      kind: 'reversal',
      target: original.target,
      before: original.after,
      after: original.before,
      source: 'user-confirmed',
      evidenceIds: original.evidenceIds,
      ...(original.observedAt ? { observedAt: original.observedAt } : {}),
      classifiedAt: at,
      migrationId: ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID,
      reversalOf: original.id,
      reason: '用户撤销支付宝分类迁移；以追加事件恢复迁移前分类。',
    });
    state = appendClassificationEvent(state, reversal);
  }
  return {
    ...state,
    migrations: {
      ...state.migrations,
      [ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID]: {
        ...record,
        status: 'reversed',
        reversedAt: at,
      },
    },
  };
}
