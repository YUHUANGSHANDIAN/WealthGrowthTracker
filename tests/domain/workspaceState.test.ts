import { describe, expect, it } from 'vitest';
import {
  parseGoalScenarioState,
  parseHealthReviewState,
  parseWorkspaceDraftState,
  parseWorkspaceViewState,
  toggleScenarioComparison,
} from '../../src/domain/workspace/state';
import type { GoalScenarioRecord } from '../../src/domain/workspace/types';

const now = '2026-11-07T10:00:00.000Z';

function scenario(id: string, baselineAmount = 100): GoalScenarioRecord {
  return {
    id,
    goalId: 'goal-1',
    name: id,
    months: 12,
    monthlyContribution: 10,
    annualRate: 0.05,
    basis: 'all-assets',
    baselineDate: '2026-11-07',
    baselineAmount,
    baselineFingerprint: 'a'.repeat(64),
    baseDataRevision: 4,
    createdAt: now,
    updatedAt: now,
  };
}

describe('workspace 元数据', () => {
  it('为旧草稿补安全默认值，并拒绝凭据字段', () => {
    const parsed = parseWorkspaceDraftState({
      schemaVersion: 1,
      drafts: [{
        draftId: 'finance-task:task-1',
        kind: 'finance-task',
        targetId: 'task-1',
        ledgerId: 'ledger-1',
        baseRevision: 3,
        baseFingerprint: 'b'.repeat(64),
        updatedAt: now,
        payload: { title: '草稿' },
      }],
    });
    expect(parsed.drafts[0]).toMatchObject({ baseEntityRevision: 0, payloadVersion: 1 });
    expect(() => parseWorkspaceDraftState({
      schemaVersion: 1,
      drafts: [{
        ...parsed.drafts[0],
        payload: { apiKey: 'must-not-save' },
      }],
    })).toThrow('不能保存敏感字段');
  });

  it('核对记录保留账本身份、来源事件与重验时间', () => {
    const parsed = parseHealthReviewState({
      schemaVersion: 1,
      records: [{
        id: 'issue-1@ledger-1',
        issueId: 'issue-1',
        ledgerId: 'ledger-1',
        code: 'rule-duplicate',
        ruleVersion: 2,
        status: 'resolved',
        reason: '不同账户和份额',
        resolution: 'distinct-identity',
        baseRevision: 4,
        fingerprint: 'c'.repeat(16),
        actorKind: 'user',
        sourceEventIds: ['event-1'],
        operationId: 'op-1',
        revalidatedAt: now,
        updatedAt: now,
      }],
    });
    expect(parsed.records[0]).toMatchObject({
      ledgerId: 'ledger-1',
      actorKind: 'user',
      sourceEventIds: ['event-1'],
      resolution: 'distinct-identity',
    });
  });

  it('不同保存基线的目标情景不能直接加入同一比较', () => {
    const state = parseGoalScenarioState({
      schemaVersion: 1,
      scenarios: [scenario('a', 100), scenario('b', 120)],
      comparisonIds: ['a'],
    });
    expect(() => toggleScenarioComparison(state, 'b')).toThrow('同一基线');
    const same = parseGoalScenarioState({
      schemaVersion: 1,
      scenarios: [scenario('a'), scenario('b')],
      comparisonIds: ['a'],
    });
    expect(toggleScenarioComparison(same, 'b').comparisonIds).toEqual(['a', 'b']);
  });

  it('命名视图只保留安全标量筛选，并丢弃不存在的比较引用', () => {
    const views = parseWorkspaceViewState({
      schemaVersion: 1,
      namedViews: [{
        id: 'view-1',
        page: 'assets',
        name: '待核对持仓',
        filters: { query: '黄金', showArchived: false, nested: { amount: 999 } },
        createdAt: now,
        updatedAt: now,
      }],
    });
    expect(views.namedViews[0]?.filters).toEqual({ query: '黄金', showArchived: false });
    const goals = parseGoalScenarioState({
      schemaVersion: 1,
      scenarios: [scenario('a')],
      comparisonIds: ['a', 'missing'],
    });
    expect(goals.comparisonIds).toEqual(['a']);
  });
});
