import type { ExecutionRecord, InvestmentPolicy, MonthlyPlanningState, MonthlyReview } from '../../domain/portfolio/types';

export const MONTHLY_STATE_SCHEMA_VERSION = 1;

export function emptyMonthlyPlanningState(): MonthlyPlanningState {
  return {
    schemaVersion: MONTHLY_STATE_SCHEMA_VERSION,
    sessions: [],
    policies: [],
    assignmentRules: [],
    settings: { reminderEnabled: false, reminderDay: 15, reminderTime: '15:00', timezone: 'Asia/Shanghai', osTaskRegistered: false },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 读取校验：未来 schema 只读拒绝，损坏结构不静默降级为空。 */
export function parseMonthlyPlanningState(value: unknown): MonthlyPlanningState {
  if (value === null || value === undefined) return emptyMonthlyPlanningState();
  if (!isRecord(value)) throw new Error('月度理财状态结构无效');
  const version = value.schemaVersion;
  if (typeof version === 'number' && version > MONTHLY_STATE_SCHEMA_VERSION) {
    throw new Error('月度理财状态来自更新版本，当前版本禁止读写');
  }
  if (version !== MONTHLY_STATE_SCHEMA_VERSION) throw new Error('月度理财状态缺少可识别的版本');
  const { sessions, policies, assignmentRules, settings } = value;
  if (!Array.isArray(sessions) || !Array.isArray(policies) || !Array.isArray(assignmentRules)) throw new Error('月度理财状态缺少必要集合');
  const keys = new Set<string>();
  for (const session of sessions) {
    if (!isRecord(session) || typeof session.key !== 'string' || !/^monthly-planning:\d{4}-(0[1-9]|1[0-2])$/.test(session.key)) {
      throw new Error('月度会话键无效，已保留原文件');
    }
    if (keys.has(session.key)) throw new Error(`存在重复的月度会话：${session.key}`);
    keys.add(session.key);
  }
  const fallbackSettings = emptyMonthlyPlanningState().settings;
  return {
    schemaVersion: MONTHLY_STATE_SCHEMA_VERSION,
    sessions: sessions as MonthlyReview[],
    policies: policies as InvestmentPolicy[],
    assignmentRules: assignmentRules as MonthlyPlanningState['assignmentRules'],
    settings: isRecord(settings) ? { ...fallbackSettings, ...(settings as MonthlyPlanningState['settings']) } : fallbackSettings,
  };
}

export function findSession(state: MonthlyPlanningState, key: string): MonthlyReview | null {
  return state.sessions.find((session) => session.key === key) ?? null;
}

/** 写入会话：同键只能升版，不允许用更旧 revision 覆盖。 */
export function upsertSession(state: MonthlyPlanningState, session: MonthlyReview): MonthlyPlanningState {
  const existing = findSession(state, session.key);
  if (existing && session.revision < existing.revision) {
    throw new Error(`会话 ${session.key} 的 revision 不能回退（当前 ${existing.revision}）`);
  }
  if (existing && session.revision === existing.revision && JSON.stringify(existing) !== JSON.stringify(session)) {
    throw new Error(`会话 ${session.key} 同一 revision 的内容不一致，请递增 revision`);
  }
  const sessions = existing
    ? state.sessions.map((item) => (item.key === session.key ? session : item))
    : [...state.sessions, session].sort((a, b) => a.key.localeCompare(b.key));
  return { ...state, sessions };
}

export function upsertPolicy(state: MonthlyPlanningState, policy: InvestmentPolicy): MonthlyPlanningState {
  const existing = state.policies.find((item) => item.id === policy.id);
  if (existing && policy.version < existing.version) throw new Error(`策略 ${policy.id} 的版本不能回退`);
  const policies = existing ? state.policies.map((item) => (item.id === policy.id ? policy : item)) : [...state.policies, policy];
  return { ...state, policies };
}

export function recordExecution(state: MonthlyPlanningState, sessionKey: string, record: ExecutionRecord): MonthlyPlanningState {
  const session = findSession(state, sessionKey);
  if (!session) throw new Error(`会话不存在：${sessionKey}`);
  if (!session.proposal) throw new Error('会话没有候选方案，不能登记执行回执');
  if (!session.proposal.actions.some((action) => action.id === record.actionId)) {
    throw new Error('执行回执引用了不存在的候选动作');
  }
  if (session.executions.some((item) => item.id === record.id)) throw new Error('执行回执 ID 重复');
  const executions = [...session.executions, record];
  const next: MonthlyReview = { ...session, executions, revision: session.revision + 1 };
  return upsertSession(state, next);
}

export function removeSession(state: MonthlyPlanningState, key: string): MonthlyPlanningState {
  return { ...state, sessions: state.sessions.filter((session) => session.key !== key) };
}

export interface MonthlyStateSummary {
  sessions: number;
  confirmed: number;
  archived: number;
  openActions: number;
  staleCarryOver: number;
}

export function summarizeMonthlyState(state: MonthlyPlanningState, carriedItems: readonly { stale: boolean; status: string }[] = []): MonthlyStateSummary {
  return {
    sessions: state.sessions.length,
    confirmed: state.sessions.filter((session) => session.state === 'confirmed').length,
    archived: state.sessions.filter((session) => session.state === 'archived').length,
    openActions: state.sessions.reduce((total, session) => total + (session.proposal?.actions.length ?? 0) - session.executions.filter((item) => item.status === 'executed').length, 0),
    staleCarryOver: carriedItems.filter((item) => item.stale && item.status === 'open').length,
  };
}
