import { canonicalJson, sha256Text } from '../../utils/canonicalHash';
import type {
  GoalScenarioRecord,
  GoalScenarioState,
  HealthReviewRecord,
  HealthReviewState,
  LedgerIdentityState,
  NamedView,
  ReportRevisionRecord,
  ReportRevisionState,
  WorkspaceDraft,
  WorkspaceDraftState,
  WorkspaceViewState,
} from './types';
import { WORKSPACE_STATE_SCHEMA_VERSION } from './types';

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field}无效`);
  return value;
};
const date = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${field}无效`);
  return value;
};
const nonNegativeInt = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field}无效`);
  return value;
};
const positiveInt = (value: unknown, field: string): number => {
  const result = nonNegativeInt(value, field);
  if (result < 1) throw new Error(`${field}无效`);
  return result;
};
const optionalDate = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return date(value, field);
};
const DRAFT_MAX_BYTES = 96 * 1024;
const DRAFT_FORBIDDEN_KEY = /^(api.?key|token|secret|authorization|password|credential|attachments?)$/i;

function assertSafeDraftPayload(value: unknown): asserts value is Record<string, unknown> {
  if (!record(value)) throw new Error('草稿内容无效');
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    throw new Error('草稿内容无法序列化');
  }
  if (bytes > DRAFT_MAX_BYTES) throw new Error('草稿内容过大');
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (DRAFT_FORBIDDEN_KEY.test(key)) throw new Error(`草稿不能保存敏感字段：${key}`);
      visit(child);
    }
  };
  visit(value);
}

export function emptyWorkspaceDraftState(): WorkspaceDraftState {
  return { schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, drafts: [] };
}

export function emptyHealthReviewState(): HealthReviewState {
  return { schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, records: [] };
}

export function emptyReportRevisionState(): ReportRevisionState {
  return { schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, revisions: [] };
}

export function emptyGoalScenarioState(): GoalScenarioState {
  return { schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, scenarios: [], comparisonIds: [] };
}

export function emptyWorkspaceViewState(): WorkspaceViewState {
  return { schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, namedViews: [], overviewHiddenModules: [] };
}

export function createLedgerIdentity(): LedgerIdentityState {
  return { schemaVersion: 1, ledgerId: crypto.randomUUID(), createdAt: new Date().toISOString() };
}

export function parseLedgerIdentity(value: unknown): LedgerIdentityState {
  if (value === null || value === undefined) return createLedgerIdentity();
  if (!record(value) || value.schemaVersion !== 1) throw new Error('账本身份版本无效');
  return {
    schemaVersion: 1,
    ledgerId: text(value.ledgerId, '账本身份', 160),
    createdAt: date(value.createdAt, '账本身份时间'),
  };
}

export function workspaceDraftId(kind: WorkspaceDraft['kind'], targetId: string): string {
  return `${kind}:${targetId}`;
}

export async function fingerprintWorkspaceTarget(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value));
}

export function parseWorkspaceDraftState(value: unknown): WorkspaceDraftState {
  if (value === null || value === undefined) return emptyWorkspaceDraftState();
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.drafts)) throw new Error('草稿状态无效');
  const ids = new Set<string>();
  const drafts: WorkspaceDraft[] = value.drafts.map((raw) => {
    if (!record(raw) || !['finance-task', 'finance-policy', 'finance-comparison', 'report-edit', 'goal-scenario', 'history-edit'].includes(String(raw.kind))) {
      throw new Error('草稿记录无效');
    }
    assertSafeDraftPayload(raw.payload);
    const draft: WorkspaceDraft = {
      draftId: text(raw.draftId, '草稿标识', 400),
      kind: raw.kind as WorkspaceDraft['kind'],
      targetId: text(raw.targetId, '草稿目标', 400),
      ledgerId: text(raw.ledgerId, '草稿账本身份', 160),
      baseRevision: nonNegativeInt(raw.baseRevision, '草稿基线版本'),
      baseEntityRevision: raw.baseEntityRevision === undefined ? 0 : nonNegativeInt(raw.baseEntityRevision, '草稿实体版本'),
      baseFingerprint: text(raw.baseFingerprint, '草稿指纹', 128),
      payloadVersion: raw.payloadVersion === undefined ? 1 : positiveInt(raw.payloadVersion, '草稿载荷版本'),
      updatedAt: date(raw.updatedAt, '草稿时间'),
      payload: raw.payload,
    };
    if (ids.has(draft.draftId)) throw new Error(`草稿标识重复：${draft.draftId}`);
    ids.add(draft.draftId);
    return draft;
  });
  return { schemaVersion: 1, drafts };
}

export function parseHealthReviewState(value: unknown): HealthReviewState {
  if (value === null || value === undefined) return emptyHealthReviewState();
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error('核对处理状态无效');
  const ids = new Set<string>();
  const records: HealthReviewRecord[] = value.records.map((raw) => {
    if (!record(raw)
      || !['acknowledged', 'deferred', 'resolved'].includes(String(raw.status))
      || (raw.resolution !== undefined && !['distinct-identity', 'evidence-accepted', 'data-corrected', 'not-applicable'].includes(String(raw.resolution)))) {
      throw new Error('核对处理记录无效');
    }
    const item: HealthReviewRecord = {
      id: text(raw.id, '处理记录标识'),
      issueId: text(raw.issueId, '问题标识', 400),
      ledgerId: typeof raw.ledgerId === 'string' && raw.ledgerId.trim() ? text(raw.ledgerId, '处理账本身份', 160) : 'legacy',
      code: text(raw.code, '问题代码'),
      ruleVersion: nonNegativeInt(raw.ruleVersion, '规则版本'),
      status: raw.status as HealthReviewRecord['status'],
      reason: text(raw.reason, '处理原因', 2_000),
      ...(raw.resolution ? { resolution: raw.resolution as HealthReviewRecord['resolution'] } : {}),
      baseRevision: nonNegativeInt(raw.baseRevision, '处理基线版本'),
      fingerprint: text(raw.fingerprint, '处理指纹', 128),
      actorKind: 'user',
      sourceEventIds: Array.isArray(raw.sourceEventIds)
        ? raw.sourceEventIds.filter((id): id is string => typeof id === 'string').slice(0, 128)
        : [],
      operationId: typeof raw.operationId === 'string' && raw.operationId.trim() ? text(raw.operationId, '操作标识', 400) : String(raw.id),
      ...(optionalDate(raw.reviewAfter, '复核时间') ? { reviewAfter: optionalDate(raw.reviewAfter, '复核时间') } : {}),
      ...(optionalDate(raw.revalidatedAt, '重新校验时间') ? { revalidatedAt: optionalDate(raw.revalidatedAt, '重新校验时间') } : {}),
      updatedAt: date(raw.updatedAt, '处理时间'),
    };
    if (ids.has(item.id)) throw new Error(`核对处理记录重复：${item.id}`);
    ids.add(item.id);
    return item;
  });
  return { schemaVersion: 1, records };
}

export function parseReportRevisionState(value: unknown): ReportRevisionState {
  if (value === null || value === undefined) return emptyReportRevisionState();
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.revisions)) throw new Error('报告修订状态无效');
  const ids = new Set<string>();
  const revisions: ReportRevisionRecord[] = value.revisions.map((raw) => {
    if (!record(raw) || !record(raw.snapshot) || !/^[a-f0-9]{64}$/.test(String(raw.contentHash))) throw new Error('报告修订记录无效');
    const item: ReportRevisionRecord = {
      id: text(raw.id, '报告修订标识', 400),
      reportId: text(raw.reportId, '报告标识', 300),
      revision: nonNegativeInt(raw.revision, '报告修订号'),
      action: raw.action as ReportRevisionRecord['action'],
      capturedAt: date(raw.capturedAt, '报告修订时间'),
      baseDataRevision: nonNegativeInt(raw.baseDataRevision, '报告修订基线'),
      contentHash: String(raw.contentHash),
      snapshot: raw.snapshot,
    };
    if (ids.has(item.id)) throw new Error(`报告修订重复：${item.id}`);
    ids.add(item.id);
    return item;
  });
  return { schemaVersion: 1, revisions };
}

export function parseGoalScenarioState(value: unknown): GoalScenarioState {
  if (value === null || value === undefined) return emptyGoalScenarioState();
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.scenarios)) throw new Error('目标情景状态无效');
  const ids = new Set<string>();
  const countsByGoal = new Map<string, number>();
  const scenarios: GoalScenarioRecord[] = value.scenarios.map((raw) => {
    if (!record(raw) || !['all-assets', 'all-net-assets', 'investable-assets', 'investable-net-assets'].includes(String(raw.basis))) {
      throw new Error('目标情景记录无效');
    }
    const item: GoalScenarioRecord = {
      id: text(raw.id, '情景标识'),
      goalId: text(raw.goalId, '目标标识'),
      name: text(raw.name, '情景名称', 120),
      months: nonNegativeInt(raw.months, '情景期限'),
      monthlyContribution: typeof raw.monthlyContribution === 'number' && Number.isFinite(raw.monthlyContribution) && raw.monthlyContribution >= 0 ? raw.monthlyContribution : null,
      annualRate: typeof raw.annualRate === 'number' && Number.isFinite(raw.annualRate) ? raw.annualRate : null,
      basis: raw.basis as GoalScenarioRecord['basis'],
      baselineDate: text(raw.baselineDate, '情景基线日期'),
      baselineAmount: typeof raw.baselineAmount === 'number' && Number.isFinite(raw.baselineAmount) && raw.baselineAmount >= 0
        ? raw.baselineAmount
        : null,
      ...(typeof raw.baselineFingerprint === 'string' && /^[a-f0-9]{64}$/.test(raw.baselineFingerprint)
        ? { baselineFingerprint: raw.baselineFingerprint }
        : {}),
      baseDataRevision: nonNegativeInt(raw.baseDataRevision, '情景基线版本'),
      createdAt: date(raw.createdAt, '情景创建时间'),
      updatedAt: date(raw.updatedAt, '情景更新时间'),
    };
    if (ids.has(item.id)) throw new Error(`目标情景重复：${item.id}`);
    ids.add(item.id);
    const count = (countsByGoal.get(item.goalId) ?? 0) + 1;
    if (count > 12) throw new Error('同一目标最多保存 12 个情景');
    countsByGoal.set(item.goalId, count);
    return item;
  });
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const requestedComparisons = Array.isArray(value.comparisonIds)
    ? [...new Set(value.comparisonIds.filter((id): id is string => typeof id === 'string' && scenarioIds.has(id)))].slice(0, 3)
    : [];
  const comparisonIds: string[] = [];
  for (const id of requestedComparisons) {
    const candidate = scenarios.find((scenario) => scenario.id === id)!;
    const first = scenarios.find((scenario) => scenario.id === comparisonIds[0]);
    if (!first || scenariosShareBaseline(first, candidate)) comparisonIds.push(id);
  }
  return { schemaVersion: 1, scenarios, comparisonIds };
}

export function parseWorkspaceViewState(value: unknown): WorkspaceViewState {
  if (value === null || value === undefined) return emptyWorkspaceViewState();
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.namedViews)) throw new Error('界面视图状态无效');
  const names = new Set<string>();
  const namedViews: NamedView[] = value.namedViews.map((raw) => {
    if (!record(raw) || !record(raw.filters) || !['overview', 'assets', 'history', 'reports', 'analysis', 'monthly', 'prediction', 'goals', 'lottery', 'data'].includes(String(raw.page))) {
      throw new Error('命名视图无效');
    }
    const view: NamedView = {
      id: text(raw.id, '视图标识'),
      page: raw.page as NamedView['page'],
      name: text(raw.name, '视图名称', 80),
      filters: Object.fromEntries(Object.entries(raw.filters).flatMap(([key, value]) =>
        typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || value === null
          ? [[key, value]]
          : [])),
      createdAt: date(raw.createdAt, '视图创建时间'),
      updatedAt: date(raw.updatedAt, '视图更新时间'),
    };
    const key = `${view.page}:${view.name}`;
    if (names.has(key)) throw new Error(`命名视图重复：${view.name}`);
    names.add(key);
    return view;
  });
  const overviewHiddenModules = Array.isArray(value.overviewHiddenModules)
    ? [...new Set(value.overviewHiddenModules.filter((id): id is string => typeof id === 'string'))]
      .filter((id) => ['trend', 'work', 'reports'].includes(id))
      .slice(0, 16)
    : [];
  return { schemaVersion: 1, namedViews, overviewHiddenModules };
}

export function upsertWorkspaceDraft(state: WorkspaceDraftState, draft: WorkspaceDraft): WorkspaceDraftState {
  return {
    schemaVersion: 1,
    drafts: [...state.drafts.filter((item) => item.draftId !== draft.draftId), draft]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export function removeWorkspaceDraft(state: WorkspaceDraftState, draftId: string): WorkspaceDraftState {
  return { schemaVersion: 1, drafts: state.drafts.filter((item) => item.draftId !== draftId) };
}

export function upsertHealthReview(state: HealthReviewState, review: HealthReviewRecord): HealthReviewState {
  return {
    schemaVersion: 1,
    records: [...state.records.filter((item) => item.issueId !== review.issueId), review],
  };
}

export function appendReportRevision(state: ReportRevisionState, revision: ReportRevisionRecord): ReportRevisionState {
  if (state.revisions.some((item) => item.id === revision.id)) return state;
  return { schemaVersion: 1, revisions: [...state.revisions, revision] };
}

export function upsertGoalScenario(state: GoalScenarioState, scenario: GoalScenarioRecord): GoalScenarioState {
  const sameGoal = state.scenarios.filter((item) => item.goalId === scenario.goalId && item.id !== scenario.id);
  if (sameGoal.length >= 12 && !state.scenarios.some((item) => item.id === scenario.id)) throw new Error('同一目标最多保存 12 个情景');
  const nextScenarios = [...state.scenarios.filter((item) => item.id !== scenario.id), scenario];
  const byId = new Map(nextScenarios.map((item) => [item.id, item]));
  return {
    schemaVersion: 1,
    scenarios: nextScenarios,
    comparisonIds: state.comparisonIds.filter((id) => id === scenario.id || byId.has(id)).slice(0, 3),
  };
}

export function scenariosShareBaseline(a: GoalScenarioRecord, b: GoalScenarioRecord): boolean {
  return a.goalId === b.goalId
    && a.basis === b.basis
    && a.baselineDate === b.baselineDate
    && a.baselineAmount !== null
    && b.baselineAmount !== null
    && a.baselineAmount === b.baselineAmount
    && (!a.baselineFingerprint || !b.baselineFingerprint || a.baselineFingerprint === b.baselineFingerprint);
}

export function toggleScenarioComparison(state: GoalScenarioState, id: string): GoalScenarioState {
  const scenario = state.scenarios.find((item) => item.id === id);
  if (!scenario) throw new Error('情景不存在');
  const selected = state.comparisonIds.includes(id);
  if (!selected) {
    const selectedScenarios = state.scenarios.filter((item) => state.comparisonIds.includes(item.id));
    if (selectedScenarios.some((item) => !scenariosShareBaseline(item, scenario))) {
      throw new Error('只有同一基线、同一计算口径的情景可以直接比较');
    }
  }
  const comparisonIds = selected ? state.comparisonIds.filter((item) => item !== id) : [...state.comparisonIds, id];
  if (comparisonIds.length > 3) throw new Error('最多同时比较 3 个情景');
  return { ...state, comparisonIds };
}
