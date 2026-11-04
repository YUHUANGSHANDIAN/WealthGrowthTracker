import type { Holding, MonthlyPlanningState } from '../portfolio/types';
import { canonicalJson, sha256Text } from '../../utils/canonicalHash';

export const ASSET_CLASSIFICATION_SCHEMA_VERSION = 1;
export const ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID = 'alipay-gold-classification-v1';

export type ProductKind =
  | 'fund-etf-feeder'
  | 'bank-gold-accumulation'
  | 'fund-other'
  | 'cash'
  | 'fixed-income'
  | 'other';

export type ClassificationSource = 'user-confirmed' | 'provider-evidence' | 'rule-proposed';

export interface ClassificationTarget {
  type: 'channel' | 'holding' | 'product';
  id: string;
  taskId?: string;
}

export interface ClassificationSnapshot {
  displayName?: string;
  childChannelId?: string;
  productKind: ProductKind;
  shareClass?: 'A' | 'C' | 'other';
  exposureTags: string[];
  amountBasis?: 'channel-total' | 'holding-observation' | 'unallocated';
}

export interface AssetClassificationEvent {
  id: string;
  contentHash: string;
  kind: 'channel-rename' | 'product-classify' | 'holding-reclassify' | 'reversal';
  target: ClassificationTarget;
  before: ClassificationSnapshot | null;
  after: ClassificationSnapshot | null;
  source: ClassificationSource;
  evidenceIds: string[];
  observedAt?: string;
  classifiedAt: string;
  migrationId?: string;
  reversalOf?: string;
  reason: string;
}

export interface AppliedAssetClassificationMigration {
  id: string;
  status: 'applied' | 'reversed';
  appliedAt: string;
  reversedAt?: string;
  backupSha256: string;
  dryRunSha256: string;
  appliedEventIds: string[];
}

export interface AssetClassificationState {
  schemaVersion: 1;
  migrations: Record<string, AppliedAssetClassificationMigration>;
  events: AssetClassificationEvent[];
}

export interface HoldingClassificationResult {
  childChannelId?: string;
  productKind: ProductKind;
  shareClass?: 'A' | 'C' | 'other';
  exposureTags: string[];
  amountBasis: 'holding-observation';
  confidence: 'high' | 'review';
  issues: string[];
}

export type ClassificationEventInput = Omit<AssetClassificationEvent, 'id' | 'contentHash'>;

const PRODUCT_KINDS = new Set<ProductKind>([
  'fund-etf-feeder', 'bank-gold-accumulation', 'fund-other', 'cash', 'fixed-income', 'other',
]);
const SOURCES = new Set<ClassificationSource>(['user-confirmed', 'provider-evidence', 'rule-proposed']);
const EVENT_KINDS = new Set<AssetClassificationEvent['kind']>([
  'channel-rename', 'product-classify', 'holding-reclassify', 'reversal',
]);
const HASH = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 300
    && [...value].every((character) => character.charCodeAt(0) >= 32);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseSnapshot(value: unknown, label: string): ClassificationSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.productKind !== 'string' || !PRODUCT_KINDS.has(value.productKind as ProductKind)) {
    throw new Error(`${label}产品类型无效`);
  }
  if (!Array.isArray(value.exposureTags) || value.exposureTags.some((tag) => !validId(tag))) {
    throw new Error(`${label}风险敞口无效`);
  }
  if (value.displayName !== undefined && !validId(value.displayName)) throw new Error(`${label}显示名称无效`);
  if (value.childChannelId !== undefined && !validId(value.childChannelId)) throw new Error(`${label}子渠道无效`);
  if (value.shareClass !== undefined && !['A', 'C', 'other'].includes(String(value.shareClass))) throw new Error(`${label}份额类别无效`);
  if (value.amountBasis !== undefined && !['channel-total', 'holding-observation', 'unallocated'].includes(String(value.amountBasis))) {
    throw new Error(`${label}金额基准无效`);
  }
  return {
    ...(value.displayName !== undefined ? { displayName: value.displayName as string } : {}),
    ...(value.childChannelId !== undefined ? { childChannelId: value.childChannelId as string } : {}),
    productKind: value.productKind as ProductKind,
    ...(value.shareClass !== undefined ? { shareClass: value.shareClass as 'A' | 'C' | 'other' } : {}),
    exposureTags: [...new Set(value.exposureTags as string[])].sort(),
    ...(value.amountBasis !== undefined ? { amountBasis: value.amountBasis as ClassificationSnapshot['amountBasis'] } : {}),
  };
}

export function emptyAssetClassificationState(): AssetClassificationState {
  return { schemaVersion: ASSET_CLASSIFICATION_SCHEMA_VERSION, migrations: {}, events: [] };
}

export function classificationTargetKey(target: ClassificationTarget): string {
  return `${target.type}:${target.taskId ? `${target.taskId}:` : ''}${target.id}`;
}

export function parseAssetClassificationState(value: unknown): AssetClassificationState {
  if (value === null || value === undefined) return emptyAssetClassificationState();
  if (!isRecord(value)) throw new Error('资产分类状态结构无效');
  if (value.schemaVersion !== ASSET_CLASSIFICATION_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number' && value.schemaVersion > ASSET_CLASSIFICATION_SCHEMA_VERSION) {
      throw new Error('资产分类状态来自更新版本，当前版本禁止读写');
    }
    throw new Error('资产分类状态缺少可识别版本');
  }
  const events: AssetClassificationEvent[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(value.events) || value.events.length > 20_000) throw new Error('资产分类事件集合无效');
  for (const raw of value.events) {
    if (!isRecord(raw)
      || !validId(raw.id) || ids.has(raw.id)
      || typeof raw.contentHash !== 'string' || !HASH.test(raw.contentHash)
      || typeof raw.kind !== 'string' || !EVENT_KINDS.has(raw.kind as AssetClassificationEvent['kind'])
      || !isRecord(raw.target) || !['channel', 'holding', 'product'].includes(String(raw.target.type))
      || !validId(raw.target.id)
      || (raw.target.taskId !== undefined && !validId(raw.target.taskId))
      || typeof raw.source !== 'string' || !SOURCES.has(raw.source as ClassificationSource)
      || !Array.isArray(raw.evidenceIds) || raw.evidenceIds.some((id) => !validId(id))
      || !validDate(raw.classifiedAt)
      || (raw.observedAt !== undefined && !validDate(raw.observedAt))
      || typeof raw.reason !== 'string' || raw.reason.length > 2_000
      || (raw.reversalOf !== undefined && !validId(raw.reversalOf))
      || (raw.migrationId !== undefined && !validId(raw.migrationId))) {
      throw new Error('资产分类事件无效');
    }
    ids.add(raw.id);
    events.push({
      id: raw.id,
      contentHash: raw.contentHash,
      kind: raw.kind as AssetClassificationEvent['kind'],
      target: {
        type: raw.target.type as ClassificationTarget['type'],
        id: raw.target.id,
        ...(raw.target.taskId !== undefined ? { taskId: raw.target.taskId } : {}),
      },
      before: parseSnapshot(raw.before, '分类事件 before '),
      after: parseSnapshot(raw.after, '分类事件 after '),
      source: raw.source as ClassificationSource,
      evidenceIds: [...new Set(raw.evidenceIds)].sort(),
      ...(raw.observedAt !== undefined ? { observedAt: raw.observedAt } : {}),
      classifiedAt: raw.classifiedAt,
      ...(raw.migrationId !== undefined ? { migrationId: raw.migrationId } : {}),
      ...(raw.reversalOf !== undefined ? { reversalOf: raw.reversalOf } : {}),
      reason: raw.reason,
    });
  }
  const migrations: Record<string, AppliedAssetClassificationMigration> = {};
  if (value.migrations !== undefined) {
    if (!isRecord(value.migrations)) throw new Error('资产分类迁移账本无效');
    for (const [id, raw] of Object.entries(value.migrations)) {
      if (!validId(id) || !isRecord(raw)
        || raw.id !== id
        || (raw.status !== undefined && raw.status !== 'applied' && raw.status !== 'reversed')
        || !validDate(raw.appliedAt)
        || (raw.reversedAt !== undefined && !validDate(raw.reversedAt))
        || typeof raw.backupSha256 !== 'string' || !HASH.test(raw.backupSha256)
        || typeof raw.dryRunSha256 !== 'string' || !HASH.test(raw.dryRunSha256)
        || !Array.isArray(raw.appliedEventIds) || raw.appliedEventIds.some((eventId) => !validId(eventId))) {
        throw new Error(`资产分类迁移记录无效：${id}`);
      }
      migrations[id] = {
        id,
        status: raw.status === 'reversed' ? 'reversed' : 'applied',
        appliedAt: raw.appliedAt,
        ...(raw.reversedAt !== undefined ? { reversedAt: raw.reversedAt } : {}),
        backupSha256: raw.backupSha256,
        dryRunSha256: raw.dryRunSha256,
        appliedEventIds: [...new Set(raw.appliedEventIds)],
      };
    }
  }
  return { schemaVersion: ASSET_CLASSIFICATION_SCHEMA_VERSION, migrations, events };
}

export function latestClassificationEvent(
  state: AssetClassificationState,
  target: ClassificationTarget,
): AssetClassificationEvent | null {
  const key = classificationTargetKey(target);
  let latest: AssetClassificationEvent | null = null;
  for (const event of state.events) {
    if (classificationTargetKey(event.target) !== key) continue;
    if (!latest || event.classifiedAt >= latest.classifiedAt) latest = event;
  }
  return latest;
}

export function classificationForHolding(
  state: AssetClassificationState,
  taskId: string,
  holdingId: string,
): ClassificationSnapshot | null {
  return latestClassificationEvent(state, { type: 'holding', id: holdingId, taskId })?.after ?? null;
}

export function classificationForChannel(state: AssetClassificationState, channelId: string): ClassificationSnapshot | null {
  return latestClassificationEvent(state, { type: 'channel', id: channelId })?.after ?? null;
}

export function productClassifications(
  state: AssetClassificationState,
  channelId: string,
): Array<{ targetId: string; snapshot: ClassificationSnapshot; event: AssetClassificationEvent }> {
  const latest = new Map<string, AssetClassificationEvent>();
  for (const event of state.events) {
    if (event.target.type !== 'product' || event.after?.amountBasis !== 'channel-total') continue;
    if (event.after.childChannelId !== channelId) continue;
    const previous = latest.get(event.target.id);
    if (!previous || event.classifiedAt >= previous.classifiedAt) latest.set(event.target.id, event);
  }
  return [...latest.entries()]
    .filter((entry): entry is [string, AssetClassificationEvent & { after: ClassificationSnapshot }] => entry[1].after !== null)
    .map(([targetId, event]) => ({ targetId, snapshot: event.after, event }))
    .sort((a, b) => a.targetId.localeCompare(b.targetId));
}

export async function createClassificationEvent(input: ClassificationEventInput): Promise<AssetClassificationEvent> {
  const id = crypto.randomUUID();
  const contentHash = await sha256Text(canonicalJson({ ...input, id }));
  return { ...input, id, contentHash };
}

export async function verifyAssetClassificationIntegrity(
  state: AssetClassificationState,
): Promise<{ state: AssetClassificationState; changed: boolean }> {
  for (const event of state.events) {
    const { id, contentHash, ...input } = event;
    const expected = await sha256Text(canonicalJson({ ...input, id }));
    if (expected !== contentHash) throw new Error(`资产分类事件内容哈希不符：${id}`);
  }
  return { state, changed: false };
}

export function appendClassificationEvent(
  state: AssetClassificationState,
  event: AssetClassificationEvent,
): AssetClassificationState {
  if (state.events.some((item) => item.id === event.id)) throw new Error('资产分类事件 ID 重复');
  return { ...state, events: [...state.events, event] };
}

export function mergeAssetClassificationStates(
  base: AssetClassificationState,
  incoming: AssetClassificationState,
): AssetClassificationState {
  const events = new Map(base.events.map((event) => [event.id, event]));
  for (const event of incoming.events) {
    const existing = events.get(event.id);
    if (existing && existing.contentHash !== event.contentHash) {
      throw new Error(`资产分类事件 ID 冲突：${event.id}`);
    }
    events.set(event.id, event);
  }
  return {
    schemaVersion: ASSET_CLASSIFICATION_SCHEMA_VERSION,
    migrations: { ...base.migrations, ...incoming.migrations },
    events: [...events.values()].sort((a, b) => a.classifiedAt.localeCompare(b.classifiedAt) || a.id.localeCompare(b.id)),
  };
}

export function inferShareClass(name: string): 'A' | 'C' | 'other' {
  const matches = [...name.matchAll(/(?:联接|指数|混合|股票|债券|配置|增长|精选|基金)?\s*([AC])(?=\(|（|$)/gi)];
  const value = matches[matches.length - 1]?.[1]?.toUpperCase();
  return value === 'A' || value === 'C' ? value : 'other';
}

/** Conservative product classification. The caller must preview low-confidence changes. */
export function classifyFundHolding(input: {
  name: string;
  fundCode?: string;
  shareClass?: string;
  parentChannelId: string;
  childChannelId?: string;
  exposureTags: string[];
  productType: Holding['productType'];
}): HoldingClassificationResult {
  const gold = /黄金/.test(input.name);
  const feeder = gold && /ETF\s*联接|ETF联接/i.test(input.name);
  const issues: string[] = [];
  const exposureTags = new Set(input.exposureTags);
  if (gold) exposureTags.add('gold');
  let childChannelId = input.childChannelId;
  if (input.parentChannelId === 'alipay' && input.productType === 'fund') childChannelId = 'alipay_fund';
  if (!input.fundCode && input.productType === 'fund') issues.push('基金代码缺失');
  const shareClass = input.shareClass === 'A' || input.shareClass === 'C'
    ? input.shareClass
    : input.shareClass === 'other' ? 'other' : inferShareClass(input.name);
  return {
    ...(childChannelId ? { childChannelId } : {}),
    productKind: feeder ? 'fund-etf-feeder' : input.productType === 'fund' ? 'fund-other' : 'other',
    shareClass,
    exposureTags: [...exposureTags].sort(),
    amountBasis: 'holding-observation',
    confidence: issues.length ? 'review' : 'high',
    issues,
  };
}

/** Read-only projection. Archived task snapshots remain byte-for-byte unchanged. */
export function projectMonthlyPlanningClassification(
  planning: MonthlyPlanningState,
  classifications: AssetClassificationState,
): MonthlyPlanningState {
  if (!classifications.events.length) return planning;
  return {
    ...planning,
    sessions: planning.sessions.map((session) => ({
      ...session,
      holdings: session.holdings.map((holding) => {
        const classification = classificationForHolding(classifications, session.key, holding.id);
        if (!classification) return holding;
        return {
          ...holding,
          ...(classification.childChannelId ? { childChannelId: classification.childChannelId } : {}),
          ...(classification.shareClass ? { shareClass: classification.shareClass } : {}),
          exposureTags: classification.exposureTags,
        };
      }),
    })),
  };
}
