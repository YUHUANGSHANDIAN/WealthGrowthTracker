import { checkPlanPenetration, type PlanPenetrationCheck } from './totals';
import { isDecimalText } from './decimal';
import type { CashFlowEvent, Holding, MonthlyReview, SourceDocument } from './types';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface SessionIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  entityId?: string;
}

export interface ValidationContext {
  /** 主应用现有父渠道 ID */
  parentChannelIds: ReadonlySet<string>;
  /** 父渠道 → 子渠道 ID */
  childIdsByParent: ReadonlyMap<string, ReadonlySet<string>>;
}

const MONTHLY_KEY = /^monthly-planning:\d{4}-(0[1-9]|1[0-2])$/;

function duplicates<T>(items: readonly T[], id: (item: T) => string): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) dupes.push(key);
    seen.add(key);
  }
  return [...new Set(dupes)];
}

function hasEvidence(items: readonly { sourceId?: string }[] | undefined): boolean {
  return Array.isArray(items) && items.length > 0 && items.every((item) => typeof item.sourceId === 'string' && item.sourceId.length > 0);
}

/**
 * 会话级不变量。引擎只报告问题，绝不静默补零或改写事实。
 * 五轴状态必须自洽：证据来源必须有证据；legacy-ai 不得被标为已通过；观察值必须有日期。
 */
export function validateMonthlySession(session: MonthlyReview, ctx: ValidationContext): SessionIssue[] {
  const issues: SessionIssue[] = [];
  const push = (code: string, severity: IssueSeverity, message: string, entityId?: string) =>
    issues.push({ code, severity, message, ...(entityId ? { entityId } : {}) });

  if (!MONTHLY_KEY.test(session.key)) push('key-format', 'error', '会话键必须是 monthly-planning:YYYY-MM');
  if (session.planningMonth && session.key !== `monthly-planning:${session.planningMonth}`) {
    push('key-month-mismatch', 'error', '会话键与 planningMonth 不一致');
  }
  if (!Number.isInteger(session.revision) || session.revision < 1) push('revision', 'error', 'revision 必须是 >=1 的整数');
  if (session.reviewPeriodStart > session.reviewPeriodEnd) push('period-order', 'error', '复盘区间起点晚于终点');
  if (session.snapshotAsOf < session.reviewPeriodEnd) push('snapshot-before-period', 'warning', '快照时点早于复盘区间终点');
  if (session.state === 'confirmed' || session.state === 'archived') {
    if (!session.proposal) push('confirmed-without-proposal', 'error', '已确认会话必须有关联方案');
    if (session.policyVersion === null) push('confirmed-without-policy', 'error', '已确认会话必须记录策略版本');
    if (session.baseDataRevision === null) push('confirmed-without-revision', 'error', '已确认会话必须记录主应用数据版本');
  }
  for (const [label, dupes] of [
    ['文档', duplicates(session.documents, (d) => d.id)],
    ['持仓', duplicates(session.holdings, (h) => h.id)],
    ['观察', duplicates(session.observations, (o) => o.id)],
    ['计划', duplicates(session.plans, (p) => p.id)],
    ['事件', duplicates(session.cashFlows, (c) => c.id)],
    ['资料', duplicates(session.research, (r) => r.id)],
  ] as const) {
    for (const id of dupes) push('duplicate-id', 'error', `${label} ID 重复：${id}`, id);
  }
  for (const id of duplicates(session.cashFlows, (c) => c.id)) push('duplicate-id', 'error', `事件 ID 重复：${id}`, id);

  const documentIds = new Set(session.documents.map((d) => d.id));
  for (const document of session.documents) validateDocument(document, documentIds, push);

  const holdingIds = new Set(session.holdings.map((h) => h.id));
  for (const holding of session.holdings) validateHolding(holding, holdingIds, ctx, push);

  const observationKeys = new Set<string>();
  for (const observation of session.observations) {
    if (!holdingIds.has(observation.holdingId)) push('observation-orphan', 'error', '观察引用了不存在的持仓', observation.id);
    if (observation.sessionKey !== session.key) push('observation-session-mismatch', 'error', '观察的会话键与会话不一致', observation.id);
    const unique = `${observation.holdingId}@${observation.sessionKey}`;
    if (observationKeys.has(unique)) push('observation-duplicate', 'error', '同一持仓在同一会话存在多条观察', observation.id);
    observationKeys.add(unique);
    if (observation.nav !== null && !isDecimalText(observation.nav)) push('observation-nav-format', 'error', '净值必须是十进制字符串', observation.id);
    if (observation.nav !== null && !observation.navDate) push('observation-nav-date', 'error', '有净值时必须给出净值日期', observation.id);
    if (observation.shares !== null && !isDecimalText(observation.shares)) push('observation-shares-format', 'error', '份额必须是十进制字符串', observation.id);
    if (observation.quality.valuation === 'observed' && !hasEvidence(observation.evidence)) {
      push('observed-without-evidence', 'error', '标记为观察值但缺少证据', observation.id);
    }
    if (observation.quality.valuation === 'missing' && (observation.marketValue !== null || observation.shares !== null)) {
      push('missing-with-value', 'warning', '标记为缺失却带数值，请确认口径', observation.id);
    }
    if (observation.quality.source === 'legacy-ai' && observation.quality.review === 'passed') {
      push('legacy-ai-passed', 'error', '旧 AI 结果不能被标记为已通过', observation.id);
    }
  }

  for (const plan of session.plans) {
    const check: PlanPenetrationCheck = checkPlanPenetration(plan);
    if (!check.consistent) {
      push('plan-penetration', check.difference === null ? 'warning' : 'error',
        check.difference === null ? '计划穿透金额未知' : `计划总额与穿透明细相差 ${check.difference}`, plan.id);
    }
    if (plan.state === 'active' && plan.planTotal === null) push('plan-total-unknown', 'warning', '启用中的计划缺少计划总额', plan.id);
  }

  for (const event of session.cashFlows) validateCashFlow(event, push);

  for (const liability of session.liabilities) {
    if (liability.settled && liability.amount === null) push('liability-settled-unknown', 'error', '已结清负债必须有金额', liability.id);
    if (liability.quality.source === 'evidence' && !hasEvidence(liability.evidence)) {
      push('liability-without-evidence', 'error', '以证据为来源的负债缺少证据', liability.id);
    }
  }

  if (session.goalBasis && session.goalBasis.quality.source === 'legacy-ai' && session.goalBasis.quality.review === 'passed') {
    push('goal-legacy-ai', 'error', '目标基线不能直接采用旧 AI 结果', session.goalBasis.goalId ?? undefined);
  }

  return issues;
}

function validateDocument(document: SourceDocument, ids: ReadonlySet<string>, push: (c: string, s: IssueSeverity, m: string, id?: string) => void) {
  if (!/^[a-f0-9]{64}$/i.test(document.sha256)) push('document-hash', 'error', '文档哈希必须是 SHA-256', document.id);
  if (document.relativePath.startsWith('/') || /^[A-Za-z]:/.test(document.relativePath)) {
    push('document-absolute-path', 'error', '文档必须保存相对路径', document.id);
  }
  if (document.integrity !== 'ok') push('document-integrity', 'error', '文档完整性异常，禁止据其确认事实', document.id);
  if (!ids.has(document.id)) push('document-self', 'error', '文档 ID 缺失', document.id);
  if (document.platform === 'manual' && document.parseState === 'parsed') {
    push('manual-parsed', 'info', '手工录入不应标记为已解析', document.id);
  }
}

function validateHolding(
  holding: Holding,
  ids: ReadonlySet<string>,
  ctx: ValidationContext,
  push: (c: string, s: IssueSeverity, m: string, id?: string) => void,
) {
  if (!ids.has(holding.id)) push('holding-self', 'error', '持仓 ID 缺失', holding.id);
  if (!ctx.parentChannelIds.has(holding.parentChannelId)) {
    push('holding-parent-missing', 'error', `父渠道不存在：${holding.parentChannelId}`, holding.id);
  }
  if (holding.childChannelId) {
    const children = ctx.childIdsByParent.get(holding.parentChannelId);
    if (!children || !children.has(holding.childChannelId)) {
      push('holding-child-mismatch', 'error', '子渠道不属于该父渠道', holding.id);
    }
  }
  if (holding.fundCode && !/^[0-9A-Za-z]{1,20}$/.test(holding.fundCode)) {
    push('holding-code-format', 'error', '基金代码格式异常（前导零必须保留）', holding.id);
  }
  if (holding.productType === 'plan' && !holding.planId) push('holding-plan-missing', 'info', '计划类持仓建议关联计划 ID', holding.id);
}

function validateCashFlow(event: CashFlowEvent, push: (c: string, s: IssueSeverity, m: string, id?: string) => void) {
  if (!Number.isFinite(event.amount) || event.amount < 0) push('event-amount', 'error', '事件金额必须是非负有限数值', event.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) push('event-date', 'error', '事件日期格式无效', event.id);
  if (event.kind === 'refund' && !event.relatedEventId) push('refund-without-origin', 'error', '退款必须关联原交易', event.id);
  if ((event.kind === 'pending-buy' || event.kind === 'pending-sell') && event.alreadyIncludedInBalance === undefined) {
    push('pending-without-inclusion', 'error', '在途事件必须声明金额是否已包含在余额中', event.id);
  }
  if (event.kind === 'internal-transfer' && !event.fromChannelId && !event.toChannelId) {
    push('transfer-without-ends', 'warning', '内部转账至少需要一端渠道', event.id);
  }
  if (event.kind !== 'internal-transfer' && event.kind !== 'investment-buy' && event.kind !== 'investment-sell'
    && event.kind !== 'credit-spend' && event.kind !== 'debt-repayment' && event.kind !== 'refund'
    && event.kind !== 'pending-buy' && event.kind !== 'pending-sell' && event.quality.source === 'evidence' && !hasEvidence(event.evidence)) {
    push('event-without-evidence', 'error', '以证据为来源的事件缺少证据', event.id);
  }
}
