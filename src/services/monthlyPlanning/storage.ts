import type {
  EvidenceIndexEntry,
  ExecutionRecord,
  FinanceTaskKind,
  FinanceTaskRevision,
  InvestmentPolicy,
  MonthlyPlanningState,
  MonthlyReview,
} from '../../domain/portfolio/types';
import { FINANCE_TASK_KIND_LABELS, isFinanceTaskKey, taskKindOf } from '../../domain/portfolio/session';
import { sha256Hex } from './attachmentCodec';

export const MONTHLY_STATE_SCHEMA_VERSION = 2;

export function emptyMonthlyPlanningState(): MonthlyPlanningState {
  return {
    schemaVersion: MONTHLY_STATE_SCHEMA_VERSION,
    sessions: [],
    taskRevisions: [],
    evidenceIndex: [],
    policies: [],
    assignmentRules: [],
    settings: {
      reminderEnabled: false,
      reminderDay: 15,
      reminderTime: '15:00',
      timezone: 'Asia/Shanghai',
      osTaskRegistered: false,
      lastReminderMonth: null,
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const TASK_KINDS = new Set<FinanceTaskKind>(Object.keys(FINANCE_TASK_KIND_LABELS) as FinanceTaskKind[]);
const MATERIAL_REVISION_STATES = new Set(['planned', 'confirmed', 'reviewed', 'archived', 'cancelled']);

function normalizeTask(raw: MonthlyReview, sourceVersion: number): MonthlyReview {
  const key = raw.key;
  const kind = raw.taskKind ?? (key.startsWith('monthly-planning:') ? 'monthly-review' : 'special-research');
  if (!TASK_KINDS.has(kind)) throw new Error(`任务类型无效：${String(kind)}`);
  if (!isFinanceTaskKey(key)) throw new Error('任务键无效，已保留原文件');
  if (key.startsWith('monthly-planning:') && kind !== 'monthly-review') {
    throw new Error('正式月记录必须使用“月度复盘”任务类型');
  }
  if (kind === 'monthly-review' && !key.startsWith('monthly-planning:')) {
    throw new Error('月度复盘必须使用 monthly-planning:YYYY-MM 键');
  }
  return {
    ...raw,
    taskId: raw.taskId ?? key,
    ledgerId: raw.ledgerId ?? 'primary',
    taskKind: kind,
    title: raw.title?.trim() || FINANCE_TASK_KIND_LABELS[kind],
    linkedMonthlyTaskId: raw.linkedMonthlyTaskId ?? null,
    result: raw.result ?? null,
    ...(sourceVersion < 2
      ? {
          planningMonth: raw.planningMonth,
          reviewPeriodStart: raw.reviewPeriodStart,
          reviewPeriodEnd: raw.reviewPeriodEnd,
        }
      : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function taskSnapshotHash(task: MonthlyReview): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJson(task)));
}

async function revisionFrom(task: MonthlyReview, capturedAt: string): Promise<FinanceTaskRevision> {
  const contentHash = await taskSnapshotHash(task);
  return {
    revisionId: `${task.key}@${task.revision}:${contentHash}`,
    contentHash,
    taskId: task.key,
    revision: task.revision,
    state: task.state,
    capturedAt,
    baseDataRevision: task.baseDataRevision,
    policyVersion: task.policyVersion,
    snapshot: task,
  };
}

export function buildEvidenceIndex(sessions: readonly MonthlyReview[]): EvidenceIndexEntry[] {
  const entries = new Map<string, EvidenceIndexEntry>();
  for (const task of sessions) {
    for (const document of task.documents) {
      const existing = entries.get(document.sha256);
      if (existing && existing.relativePath !== document.relativePath) {
        throw new Error(`同一证据哈希对应了不同路径：${document.sha256}`);
      }
      const reference = { taskId: task.key, documentId: document.id };
      if (existing) {
        if (!existing.references.some((item) => item.taskId === reference.taskId && item.documentId === reference.documentId)) {
          existing.references.push(reference);
          existing.references.sort((a, b) => `${a.taskId}:${a.documentId}`.localeCompare(`${b.taskId}:${b.documentId}`));
        }
      } else {
        entries.set(document.sha256, {
          sha256: document.sha256,
          relativePath: document.relativePath,
          originalName: document.originalName,
          mime: document.mime,
          references: [reference],
        });
      }
    }
  }
  return [...entries.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
}

/** 为旧 v2 修订补齐内容哈希，并验证已有哈希没有被静默改写。 */
export async function ensureTaskRevisionIntegrity(
  state: MonthlyPlanningState,
): Promise<{ state: MonthlyPlanningState; changed: boolean }> {
  let changed = false;
  const revisions: FinanceTaskRevision[] = [];
  for (const revision of state.taskRevisions) {
    const contentHash = await taskSnapshotHash(revision.snapshot);
    if (revision.contentHash && revision.contentHash !== contentHash) {
      throw new Error(`任务修订内容哈希不符：${revision.taskId}@${revision.revision}`);
    }
    const revisionId = `${revision.taskId}@${revision.revision}:${contentHash}`;
    if (revision.revisionId && revision.revisionId !== revisionId) {
      throw new Error(`任务修订标识不符：${revision.taskId}@${revision.revision}`);
    }
    if (revision.contentHash !== contentHash || revision.revisionId !== revisionId) changed = true;
    revisions.push({ ...revision, revisionId, contentHash });
  }
  const evidenceIndex = buildEvidenceIndex(state.sessions);
  if (JSON.stringify(state.evidenceIndex) !== JSON.stringify(evidenceIndex)) changed = true;
  return {
    state: changed ? { ...state, taskRevisions: revisions, evidenceIndex } : state,
    changed,
  };
}

/** 读取校验：v1 读写迁移，v2 严格校验，未来 schema 只读拒绝。 */
export function parseMonthlyPlanningState(value: unknown): MonthlyPlanningState {
  if (value === null || value === undefined) return emptyMonthlyPlanningState();
  if (!isRecord(value)) throw new Error('月度理财状态结构无效');
  const version = value.schemaVersion;
  if (typeof version === 'number' && version > MONTHLY_STATE_SCHEMA_VERSION) {
    throw new Error('月度理财状态来自更新版本，当前版本禁止读写');
  }
  if (version !== 1 && version !== MONTHLY_STATE_SCHEMA_VERSION) {
    throw new Error('月度理财状态缺少可识别的版本');
  }
  const { sessions, policies, assignmentRules, settings } = value;
  if (!Array.isArray(sessions) || !Array.isArray(policies) || !Array.isArray(assignmentRules)) throw new Error('月度理财状态缺少必要集合');
  const keys = new Set<string>();
  const monthlyPeriods = new Set<string>();
  const normalizedSessions: MonthlyReview[] = [];
  for (const rawSession of sessions) {
    if (!isRecord(rawSession) || typeof rawSession.key !== 'string') throw new Error('理财任务键无效，已保留原文件');
    const session = normalizeTask(rawSession as unknown as MonthlyReview, version);
    if (keys.has(session.key)) throw new Error(`存在重复的月度会话：${session.key}`);
    keys.add(session.key);
    if (session.key.startsWith('monthly-planning:')) {
      const month = session.key.slice('monthly-planning:'.length);
      if (monthlyPeriods.has(month)) throw new Error(`存在重复的正式月记录：${month}`);
      monthlyPeriods.add(month);
    }
    normalizedSessions.push(session);
  }
  for (const session of normalizedSessions) {
    if (session.linkedMonthlyTaskId && !keys.has(session.linkedMonthlyTaskId)) {
      throw new Error(`临时任务关联的正式月记录不存在：${session.linkedMonthlyTaskId}`);
    }
  }
  const rawRevisions = Array.isArray(value.taskRevisions) ? value.taskRevisions : [];
  const taskRevisions: FinanceTaskRevision[] = [];
  const revisionKeys = new Set<string>();
  for (const item of rawRevisions) {
    if (!isRecord(item) || typeof item.taskId !== 'string' || !keys.has(item.taskId)
      || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision)
      || typeof item.state !== 'string' || !isRecord(item.snapshot)) continue;
    const snapshot = item.snapshot as unknown as MonthlyReview;
    if (snapshot.key !== item.taskId || snapshot.revision !== item.revision) {
      throw new Error(`任务修订快照不一致：${item.taskId}@${item.revision}`);
    }
    const revisionKey = `${item.taskId}@${item.revision}`;
    if (revisionKeys.has(revisionKey)) throw new Error(`任务修订重复：${revisionKey}`);
    revisionKeys.add(revisionKey);
    taskRevisions.push(item as unknown as FinanceTaskRevision);
  }
  const fallbackSettings = emptyMonthlyPlanningState().settings;
  return {
    schemaVersion: MONTHLY_STATE_SCHEMA_VERSION,
    sessions: normalizedSessions,
    taskRevisions,
    evidenceIndex: buildEvidenceIndex(normalizedSessions),
    policies: policies as InvestmentPolicy[],
    assignmentRules: assignmentRules as MonthlyPlanningState['assignmentRules'],
    settings: isRecord(settings) ? { ...fallbackSettings, ...(settings as MonthlyPlanningState['settings']) } : fallbackSettings,
  };
}

export function findSession(state: MonthlyPlanningState, key: string): MonthlyReview | null {
  return state.sessions.find((session) => session.key === key) ?? null;
}

/** 写入任务：同键只能升版，不允许用更旧 revision 覆盖。 */
export async function upsertSession(state: MonthlyPlanningState, session: MonthlyReview): Promise<MonthlyPlanningState> {
  const normalized = normalizeTask(session, MONTHLY_STATE_SCHEMA_VERSION);
  const existing = findSession(state, session.key);
  if (existing && session.revision < existing.revision) {
    throw new Error(`会话 ${session.key} 的 revision 不能回退（当前 ${existing.revision}）`);
  }
  if (existing && session.revision === existing.revision && JSON.stringify(existing) !== JSON.stringify(session)) {
    throw new Error(`会话 ${session.key} 同一 revision 的内容不一致，请递增 revision`);
  }
  const sessions = existing
    ? state.sessions.map((item) => (item.key === normalized.key ? normalized : item))
    : [...state.sessions, normalized].sort((a, b) => a.key.localeCompare(b.key));
  let taskRevisions = state.taskRevisions;
  if (MATERIAL_REVISION_STATES.has(normalized.state)
    && !taskRevisions.some((item) => item.taskId === normalized.key && item.revision === normalized.revision)) {
    taskRevisions = [...taskRevisions, await revisionFrom(normalized, new Date().toISOString())];
  }
  return { ...state, sessions, taskRevisions, evidenceIndex: buildEvidenceIndex(sessions) };
}

/**
 * 策略落库：同一 id 的**新版本按版本追加**，同版本原地更新，版本回退一律拒绝。
 * 旧版本必须保留，否则已确认会话记录的“所用版本”会查不到，
 * 面板承诺的“改策略产新版本、旧结果仍可复现”也就不成立了。
 */
export function upsertPolicy(state: MonthlyPlanningState, policy: InvestmentPolicy): MonthlyPlanningState {
  const versions = state.policies.filter((item) => item.id === policy.id);
  const latest = versions.reduce<InvestmentPolicy | null>((acc, item) => (!acc || item.version > acc.version ? item : acc), null);
  if (latest && policy.version < latest.version) throw new Error(`策略 ${policy.id} 的版本不能回退`);
  const sameVersion = versions.some((item) => item.version === policy.version);
  const policies = sameVersion
    ? state.policies.map((item) => (item.id === policy.id && item.version === policy.version ? policy : item))
    : [...state.policies, policy];
  return { ...state, policies };
}

export async function recordExecution(state: MonthlyPlanningState, sessionKey: string, record: ExecutionRecord): Promise<MonthlyPlanningState> {
  const session = findSession(state, sessionKey);
  if (!session) throw new Error(`会话不存在：${sessionKey}`);
  if (!session.proposal) throw new Error('会话没有候选方案，不能登记执行回执');
  if (!session.proposal.actions.some((action) => action.id === record.actionId)) {
    throw new Error('执行回执引用了不存在的候选动作');
  }
  if (session.executions.some((item) => item.id === record.id)) throw new Error('执行回执 ID 重复');
  const executions = [...session.executions, record];
  const next: MonthlyReview = { ...session, executions, revision: session.revision + 1 };
  return await upsertSession(state, next);
}

export function removeSession(state: MonthlyPlanningState, key: string): MonthlyPlanningState {
  const sessions = state.sessions.filter((session) => session.key !== key);
  return {
    ...state,
    sessions,
    taskRevisions: state.taskRevisions.filter((item) => item.taskId !== key),
    evidenceIndex: buildEvidenceIndex(sessions),
  };
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

export function findTaskRevisions(state: MonthlyPlanningState, taskId: string): FinanceTaskRevision[] {
  return state.taskRevisions.filter((item) => item.taskId === taskId).sort((a, b) => b.revision - a.revision);
}

export function isMonthlyReviewTask(task: MonthlyReview): boolean {
  return taskKindOf(task) === 'monthly-review';
}
