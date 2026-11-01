import { describe, expect, it } from 'vitest';
import {
  advanceSession,
  createDraftSession,
  createFinanceDraftSession,
  financeTaskKey,
  taskKindOf,
  transitionSession,
} from '../../src/domain/portfolio/session';
import {
  emptyMonthlyPlanningState,
  findSession,
  findTaskRevisions,
  parseMonthlyPlanningState,
  upsertSession,
} from '../../src/services/monthlyPlanning/storage';
import type { FinanceTaskKind, FinanceTaskResult } from '../../src/domain/portfolio/types';

const input = {
  planningMonth: '2026-11',
  timezone: 'Asia/Shanghai',
  today: '2026-11-01',
  now: '2026-11-01T08:00:00.000Z',
};

const result: FinanceTaskResult = {
  summary: '合成任务结果',
  findings: ['只使用合成证据'],
  noAction: true,
  confirmedAt: '2026-11-01T08:00:00.000Z',
};

describe('七类理财任务', () => {
  it.each<FinanceTaskKind>([
    'initial-reconciliation',
    'ad-hoc-rebalance',
    'fund-analysis',
    'take-profit-review',
    'market-intelligence',
    'special-research',
  ])('创建独立临时任务：%s', (taskKind) => {
    const task = createFinanceDraftSession({ ...input, taskKind, taskId: `${taskKind}-1`, title: '合成任务' });
    expect(task.key).toBe(financeTaskKey(`${taskKind}-1`));
    expect(taskKindOf(task)).toBe(taskKind);
    expect(task.linkedMonthlyTaskId).toBeNull();
  });

  it('正式月记录仍按自然月唯一，临时任务可以关联它', () => {
    const monthly = createDraftSession(input);
    const linked = createFinanceDraftSession({
      ...input, taskKind: 'fund-analysis', taskId: 'fund-1', linkedMonthlyTaskId: monthly.key,
    });
    const state = upsertSession(upsertSession(emptyMonthlyPlanningState(), monthly), linked);
    expect(findSession(state, monthly.key)?.taskKind).toBe('monthly-review');
    expect(findSession(state, linked.key)?.linkedMonthlyTaskId).toBe(monthly.key);
  });

  it('研究类任务复核无需伪造交易方案，但必须保存结果', () => {
    const draft = createFinanceDraftSession({ ...input, taskKind: 'special-research', taskId: 'research-1' });
    const reviewing = advanceSession(draft, 'reviewing', { now: input.now });
    expect(() => advanceSession(reviewing, 'reviewed', { now: input.now })).toThrow('缺少任务结果');
    const reviewed = advanceSession({ ...reviewing, result }, 'reviewed', { now: input.now });
    expect(reviewed.state).toBe('reviewed');
    expect(advanceSession(reviewed, 'archived', { now: input.now }).state).toBe('archived');
  });

  it('初始对账确认不要求候选交易，但仍记录策略和权威数据修订', () => {
    const draft = createFinanceDraftSession({ ...input, taskKind: 'initial-reconciliation', taskId: 'initial-1' });
    const ready = { ...draft, state: 'ready' as const, policyId: 'policy-a', policyVersion: 1 };
    expect(advanceSession(ready, 'confirmed', { now: input.now, baseDataRevision: 7 }).state).toBe('confirmed');
    expect(() => advanceSession(ready, 'confirmed', { now: input.now })).toThrow('缺少主应用数据版本');
  });

  it('归档重开必须递增 revision，并保留材料化修订快照', () => {
    const draft = createFinanceDraftSession({ ...input, taskKind: 'fund-analysis', taskId: 'fund-2' });
    let state = upsertSession(emptyMonthlyPlanningState(), draft);
    const reviewed = { ...draft, revision: 2, state: 'reviewed' as const, result };
    state = upsertSession(state, reviewed);
    expect(findTaskRevisions(state, draft.key)).toHaveLength(1);
    const archived = { ...transitionSession(reviewed, 'archived', { now: input.now }), revision: 3 };
    state = upsertSession(state, archived);
    expect(() => transitionSession(archived, 'reviewing', { now: input.now })).toThrow('递增 revision');
    const reopened = transitionSession(archived, 'reviewing', { now: input.now, bumpRevision: true });
    expect(reopened.revision).toBe(archived.revision + 1);
    expect(findTaskRevisions(state, draft.key)[0]?.snapshot.state).toBe('archived');
  });

  it('v1 状态只读迁移为 v2，旧月记录自动成为月度复盘', () => {
    const legacySession = createDraftSession(input);
    const migrated = parseMonthlyPlanningState({
      schemaVersion: 1,
      sessions: [legacySession],
      policies: [],
      assignmentRules: [],
      settings: { reminderEnabled: false, reminderDay: 15, reminderTime: '15:00', timezone: 'Asia/Shanghai', osTaskRegistered: false },
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.taskRevisions).toEqual([]);
    expect(migrated.sessions[0]).toMatchObject({ taskKind: 'monthly-review', taskId: legacySession.key });
  });

  it('拒绝不存在的正式月记录关联和未来 schema', () => {
    const linked = createFinanceDraftSession({
      ...input, taskKind: 'fund-analysis', taskId: 'fund-3', linkedMonthlyTaskId: 'monthly-planning:2026-10',
    });
    expect(() => parseMonthlyPlanningState({
      schemaVersion: 2, sessions: [linked], taskRevisions: [], policies: [], assignmentRules: [],
    })).toThrow('关联的正式月记录不存在');
    expect(() => parseMonthlyPlanningState({
      schemaVersion: 3, sessions: [], taskRevisions: [], policies: [], assignmentRules: [],
    })).toThrow('更新版本');
  });
});
