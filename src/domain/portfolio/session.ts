import type { SessionIssue } from './invariants';
import type { MonthlyReview, MonthlyReviewState } from './types';

export const MONTHLY_TRANSITIONS: Readonly<Record<MonthlyReviewState, readonly MonthlyReviewState[]>> = {
  draft: ['extracting', 'blocked'],
  extracting: ['reviewing', 'blocked', 'draft'],
  reviewing: ['ready', 'blocked', 'extracting'],
  ready: ['planned', 'blocked', 'reviewing'],
  planned: ['confirmed', 'blocked', 'ready'],
  confirmed: ['archived', 'planned'],
  archived: [],
  blocked: ['draft', 'extracting', 'reviewing', 'ready', 'planned'],
};

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

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

export function createDraftSession(input: CreateDraftInput): MonthlyReview {
  const key = monthlyPlanKey(input.planningMonth);
  const periodStart = input.periodStart ?? `${input.planningMonth}-01`;
  return {
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
  };
}

export function canTransition(from: MonthlyReviewState, to: MonthlyReviewState): boolean {
  return MONTHLY_TRANSITIONS[from].includes(to);
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
  if (!canTransition(session.state, next)) {
    throw new Error(`不允许的状态流转：${session.state} → ${next}`);
  }
  const issues = ctx.issues ?? [];
  if (next === 'confirmed') {
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(`存在 ${errors.length} 项错误级问题，禁止确认：${errors[0]?.message ?? ''}`);
    if (!session.proposal) throw new Error('缺少候选方案，禁止确认');
    if (session.policyVersion === null) throw new Error('缺少策略版本，禁止确认');
    if (ctx.baseDataRevision === undefined) throw new Error('缺少主应用数据版本，禁止确认');
  }
  return {
    ...session,
    state: next,
    revision: ctx.bumpRevision ? session.revision + 1 : session.revision,
    ...(next === 'confirmed' ? { baseDataRevision: ctx.baseDataRevision as number } : {}),
  };
}
