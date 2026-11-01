import type { SessionIssue } from './invariants';
import type { FinanceTaskKind, MonthlyReview, MonthlyReviewState } from './types';

export const MONTHLY_TRANSITIONS: Readonly<Record<MonthlyReviewState, readonly MonthlyReviewState[]>> = {
  draft: ['extracting', 'reviewing', 'blocked', 'cancelled'],
  extracting: ['reviewing', 'blocked', 'draft', 'cancelled'],
  reviewing: ['ready', 'blocked', 'extracting', 'cancelled'],
  ready: ['planned', 'reviewed', 'blocked', 'reviewing', 'cancelled'],
  planned: ['confirmed', 'blocked', 'ready'],
  confirmed: ['archived', 'reviewed', 'planned'],
  reviewed: ['archived', 'reviewing'],
  archived: ['reviewing'],
  blocked: ['draft', 'extracting', 'reviewing', 'ready', 'planned'],
  cancelled: [],
};

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const FINANCE_TASK_KEY = /^finance-task:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const FINANCE_TASK_KIND_LABELS: Readonly<Record<FinanceTaskKind, string>> = {
  'initial-reconciliation': '初始对账',
  'monthly-review': '月度复盘',
  'ad-hoc-rebalance': '临时调仓',
  'fund-analysis': '基金分析',
  'take-profit-review': '止盈审查',
  'market-intelligence': '市场情报',
  'special-research': '专项研究',
};

export function taskKindOf(task: Pick<MonthlyReview, 'taskKind'>): FinanceTaskKind {
  return task.taskKind ?? 'monthly-review';
}

export function isFormalMonthlyTask(task: Pick<MonthlyReview, 'key' | 'taskKind'>): boolean {
  return taskKindOf(task) === 'monthly-review' && /^monthly-planning:\d{4}-(0[1-9]|1[0-2])$/.test(task.key);
}

export function financeTaskKey(id: string): string {
  const normalized = id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error('临时任务 ID 无效');
  }
  return `finance-task:${normalized}`;
}

export function isFinanceTaskKey(key: string): boolean {
  return /^monthly-planning:\d{4}-(0[1-9]|1[0-2])$/.test(key) || FINANCE_TASK_KEY.test(key);
}

/** 会话唯一键：monthly-planning:YYYY-MM（与自然月报告 monthly:YYYY-MM 分离）。 */
export function monthlyPlanKey(planningMonth: string): string {
  if (!MONTH_KEY.test(planningMonth)) throw new Error('规划月份必须是 YYYY-MM');
  return `monthly-planning:${planningMonth}`;
}

export function currentPlanningMonth(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('日期必须是 YYYY-MM-DD');
  return today.slice(0, 7);
}

export function assertUniqueSessionKey(sessions: readonly MonthlyReview[], key: string): void {
  if (sessions.some((session) => session.key === key)) {
    throw new Error(`本月已有正式会话：${key}；请改为修订现有会话而不是新建第二份`);
  }
}

export interface CreateDraftInput {
  planningMonth: string;
  timezone: string;
  today: string;
  now: string;
  periodStart?: string;
}

export interface CreateFinanceDraftInput extends CreateDraftInput {
  taskKind: FinanceTaskKind;
  taskId?: string;
  title?: string;
  linkedMonthlyTaskId?: string | null;
}

export function createFinanceDraftSession(input: CreateFinanceDraftInput): MonthlyReview {
  if (!MONTH_KEY.test(input.planningMonth)) throw new Error('规划月份必须是 YYYY-MM');
  const key = input.taskKind === 'monthly-review'
    ? monthlyPlanKey(input.planningMonth)
    : financeTaskKey(input.taskId ?? crypto.randomUUID());
  const periodStart = input.periodStart ?? `${input.planningMonth}-01`;
  return {
    taskId: key,
    ledgerId: 'primary',
    taskKind: input.taskKind,
    title: input.title?.trim() || FINANCE_TASK_KIND_LABELS[input.taskKind],
    linkedMonthlyTaskId: input.linkedMonthlyTaskId ?? null,
    key,
    revision: 1,
    state: 'draft',
    planningMonth: input.planningMonth,
    reviewPeriodStart: periodStart,
    reviewPeriodEnd: input.today,
    snapshotAsOf: input.today,
    generatedAt: input.now,
    timezone: input.timezone,
    policyId: null,
    policyVersion: null,
    baseDataRevision: null,
    documents: [],
    holdings: [],
    observations: [],
    plans: [],
    cashFlows: [],
    liabilities: [],
    research: [],
    proposal: null,
    executions: [],
    goalBasis: null,
    result: null,
  };
}

export function createDraftSession(input: CreateDraftInput): MonthlyReview {
  return createFinanceDraftSession({ ...input, taskKind: 'monthly-review' });
}

export function canTransition(from: MonthlyReviewState, to: MonthlyReviewState): boolean {
  return MONTHLY_TRANSITIONS[from].includes(to);
}

function transitionsForKind(kind: FinanceTaskKind): Readonly<Record<MonthlyReviewState, readonly MonthlyReviewState[]>> {
  if (kind === 'initial-reconciliation' || kind === 'monthly-review'
    || kind === 'ad-hoc-rebalance' || kind === 'take-profit-review') {
    return MONTHLY_TRANSITIONS;
  }
  return {
    ...MONTHLY_TRANSITIONS,
    ready: ['reviewed', 'blocked', 'reviewing', 'cancelled'],
    planned: [],
    confirmed: [],
  };
}

export function canTransitionTask(kind: FinanceTaskKind, from: MonthlyReviewState, to: MonthlyReviewState): boolean {
  return transitionsForKind(kind)[from].includes(to);
}

/** 自动提取产生的持仓 ID 前缀：holding:doc:<hash12>:<表>:<行>。 */
export const EXTRACTED_HOLDING_PREFIX = 'holding:doc:';

/**
 * 沿 MONTHLY_TRANSITIONS 的合法边把会话推进到目标状态：不跳级、不猜路径。
 * blocked 只作为明确目标时才使用，否则会绕出一条“看起来更短”的错误路径。
 */
export function advanceSession(
  session: MonthlyReview,
  target: MonthlyReviewState,
  ctx: TransitionContext,
): MonthlyReview {
  if (session.state === target) return session;
  if (session.state === 'archived' && target !== 'reviewing') {
    throw new Error(`不允许的状态流转：${session.state} → ${target}`);
  }
  if (session.state === 'archived' && target === 'reviewing' && !ctx.bumpRevision) {
    throw new Error('重开已归档任务必须递增 revision');
  }
  const path = findTransitionPath(session.state, target, taskKindOf(session));
  if (!path) throw new Error(`不允许的状态流转：${session.state} → ${target}`);
  let current = session;
  for (const [index, next] of path.entries()) {
    const last = index === path.length - 1;
    current = transitionSession(current, next, last ? ctx : { now: ctx.now });
  }
  return current;
}

function findTransitionPath(
  from: MonthlyReviewState,
  to: MonthlyReviewState,
  kind: FinanceTaskKind,
): MonthlyReviewState[] | null {
  const queue: MonthlyReviewState[][] = [[from]];
  const visited = new Set<MonthlyReviewState>([from]);
  while (queue.length) {
    const path = queue.shift() as MonthlyReviewState[];
    const tail = path[path.length - 1] as MonthlyReviewState;
    for (const next of transitionsForKind(kind)[tail]) {
      if (next === 'blocked' && to !== 'blocked') continue;
      if (next === to) return [...path.slice(1), next];
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

export interface ConfirmBlockerInput {
  session: MonthlyReview | null;
  issues: readonly SessionIssue[];
  /** 当前生效策略的版本；没有策略时传 null。 */
  currentPolicyVersion: number | null;
}

/**
 * 确认月度计划的前置条件，按顺序给出用户能直接照做的原因。
 * 面板用它禁用按钮并说明原因，而不是让用户点下去才吃到一个异常。
 */
export function confirmBlockers(input: ConfirmBlockerInput): string[] {
  const { session, issues, currentPolicyVersion } = input;
  if (!session) return ['请先创建本月会话'];
  if (session.state === 'confirmed' || session.state === 'archived') return ['月度计划已确认，无需重复确认'];
  const blockers: string[] = [];
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) blockers.push(`存在 ${errors.length} 项错误级问题：${errors[0]?.message ?? ''}`);
  if (!session.proposal) blockers.push('还没有候选方案，请先点「生成候选」');
  if (session.policyId === null || session.policyVersion === null) {
    blockers.push('会话还没有绑定策略版本，请先点「生成候选」');
  } else if (session.proposal && session.proposal.policyVersion !== session.policyVersion) {
    blockers.push(`候选基于策略 v${session.proposal.policyVersion}，会话记录 v${session.policyVersion}，请重新生成候选`);
  } else if (currentPolicyVersion !== null && currentPolicyVersion !== session.policyVersion) {
    blockers.push(`策略已更新到 v${currentPolicyVersion}，候选基于 v${session.policyVersion}，请重新生成候选`);
  }
  return blockers;
}

export interface ClearAutoFactsResult {
  session: MonthlyReview;
  removedHoldings: number;
  removedObservations: number;
}

/**
 * 清空自动提取出来的持仓与观察（保留资料、附件、资金流、策略、研究与执行回执）。
 * 只认 id 前缀，不依赖文档内容；已进入计划或已完成的会话拒绝清空。
 */
export function clearAutoExtractedFacts(session: MonthlyReview, now: string): ClearAutoFactsResult {
  if (session.state === 'planned' || session.state === 'confirmed' || session.state === 'reviewed'
    || session.state === 'archived' || session.state === 'cancelled') {
    throw new Error('会话已进入计划或已完成，如需重来请先删除会话');
  }
  const holdings = session.holdings.filter((holding) => !holding.id.startsWith(EXTRACTED_HOLDING_PREFIX));
  const keptIds = new Set(holdings.map((holding) => holding.id));
  const observations = session.observations.filter((observation) => keptIds.has(observation.holdingId));
  const cleared: MonthlyReview = { ...session, holdings, observations, proposal: null };
  return {
    session: session.state === 'ready' ? transitionSession(cleared, 'reviewing', { now }) : cleared,
    removedHoldings: session.holdings.length - holdings.length,
    removedObservations: session.observations.length - observations.length,
  };
}

export interface TransitionContext {
  issues?: readonly SessionIssue[];
  baseDataRevision?: number;
  now: string;
  /** 修订已确认会话时递增 */
  bumpRevision?: boolean;
}

/** 状态流转；确认前必须无错误级问题，且方案/策略/数据版本齐备。 */
export function transitionSession(session: MonthlyReview, next: MonthlyReviewState, ctx: TransitionContext): MonthlyReview {
  const kind = taskKindOf(session);
  if (!canTransitionTask(kind, session.state, next)) {
    throw new Error(`不允许的状态流转：${session.state} → ${next}`);
  }
  const issues = ctx.issues ?? [];
  if (session.state === 'archived' && next === 'reviewing' && !ctx.bumpRevision) {
    throw new Error('重开已归档任务必须递增 revision');
  }
  if (next === 'confirmed') {
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(`存在 ${errors.length} 项错误级问题，禁止确认：${errors[0]?.message ?? ''}`);
    const requiresProposal = kind === 'monthly-review' || kind === 'ad-hoc-rebalance' || kind === 'take-profit-review';
    if (requiresProposal && !session.proposal) throw new Error('缺少候选方案，禁止确认');
    if (requiresProposal && session.policyVersion === null) throw new Error('缺少策略版本，禁止确认');
    if (ctx.baseDataRevision === undefined) throw new Error('缺少主应用数据版本，禁止确认');
  }
  if (next === 'reviewed' && !session.result) {
    throw new Error('缺少任务结果，不能完成复核');
  }
  return {
    ...session,
    state: next,
    revision: ctx.bumpRevision ? session.revision + 1 : session.revision,
    ...(next === 'confirmed' ? { baseDataRevision: ctx.baseDataRevision as number } : {}),
  };
}
