import { describe, expect, it } from 'vitest';
import {
  carryOverKey, carryOverPlan, checkPeriodContinuity, markCarryOverStale, mergeCarryOver, summarizeCarryOver,
} from '../../../src/domain/portfolio/carryOver';
import { createDraftSession } from '../../../src/domain/portfolio/session';
import type { CarriedItem } from '../../../src/domain/portfolio/carryOver';
import type { MonthlyReview, Proposal } from '../../../src/domain/portfolio/types';

const proposal = (actions: Proposal['actions']): Proposal => ({
  id: 'proposal:monthly-planning:2026-07',
  sessionKey: 'monthly-planning:2026-07',
  policyVersion: 3,
  createdAt: '2026-07-20T00:00:00.000Z',
  actions,
  conflicts: [],
  dataStatus: 'green',
  riskStatus: 'green',
  summary: '',
});

const action = (id: string, kind: 'buy' | 'sell' | 'take-profit') => ({
  id,
  kind,
  amount: kind === 'take-profit' ? null : 1_000,
  shares: kind === 'take-profit' ? '30.0000' : null,
  triggers: [],
  evidence: [],
  rationale: `${kind} ${id}`,
  constraintsApplied: [],
  residuals: [],
  blockers: [],
});

function confirmedSession(overrides: Partial<MonthlyReview> = {}): MonthlyReview {
  const base = createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-15', now: '2026-07-15T07:00:00.000Z' });
  return {
    ...base,
    state: 'confirmed',
    revision: 2,
    snapshotAsOf: '2026-07-15',
    policyId: 'policy-a',
    policyVersion: 3,
    baseDataRevision: 11,
    proposal: proposal([action('a-accepted', 'buy'), action('a-executed', 'sell'), action('a-rejected', 'buy'), action('a-deferred', 'take-profit'), action('a-partial', 'sell')]),
    executions: [
      { id: 'e1', proposalId: 'p', actionId: 'a-executed', status: 'executed', executedAt: '2026-07-16T00:00:00.000Z', evidence: [] },
      { id: 'e2', proposalId: 'p', actionId: 'a-rejected', status: 'rejected', executedAt: '2026-07-16T00:00:00.000Z', evidence: [] },
      { id: 'e3', proposalId: 'p', actionId: 'a-deferred', status: 'deferred', executedAt: '2026-07-16T00:00:00.000Z', evidence: [] },
      { id: 'e4', proposalId: 'p', actionId: 'a-partial', status: 'partially-executed', executedAt: '2026-07-16T00:00:00.000Z', evidence: [] },
    ],
    cashFlows: [
      {
        id: 'cf-pending', kind: 'pending-buy', date: '2026-07-14', amount: 2_000, scope: 'all', alreadyIncludedInBalance: false,
        evidence: [], quality: { source: 'user-confirmed', attribution: 'confirmed', valuation: 'observed', time: 'pending-settlement', review: 'passed' },
      },
      {
        id: 'cf-settled', kind: 'external-income', date: '2026-07-15', amount: 9_600, scope: 'all',
        evidence: [], quality: { source: 'user-confirmed', attribution: 'confirmed', valuation: 'observed', time: 'settled', review: 'passed' },
      },
    ],
    research: [
      {
        id: 'res-1', sourceUrl: 'https://example.invalid/doc', publisher: '官方公告', retrievedAt: '2026-07-15T00:00:00.000Z',
        excerpt: '费率调整', appliesTo: ['fund-1'], expiryPolicy: 'review-on-change',
        quality: { source: 'evidence', attribution: 'confirmed', valuation: 'observed', time: 'observed', review: 'passed' },
      },
    ],
    ...overrides,
  };
}

describe('月初承接可追溯性（验收项 T）', () => {
  it('T01 每一项承接都记录来源会话键、revision、原条目与快照时点', () => {
    const result = carryOverPlan({ previous: confirmedSession(), nextKey: 'monthly-planning:2026-08', nextRevision: 1 });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.origin.sessionKey).toBe('monthly-planning:2026-07');
      expect(item.origin.revision).toBe(2);
      expect(item.origin.itemId.length).toBeGreaterThan(0);
      expect(item.origin.snapshotAsOf).toBe('2026-07-15');
    }
    expect(result.periodStart).toBe('2026-07-15');
    expect(result.continuity.ok).toBe(true);
  });

  it('T02 只承接已确认/已归档会话；首期初始化不伪造上期', () => {
    const draft = createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-15', now: 'now' });
    expect(() => carryOverPlan({ previous: draft, nextKey: 'monthly-planning:2026-08', nextRevision: 1 })).toThrow('只能承接已确认或已归档');
    const first = carryOverPlan({ previous: null, nextKey: 'monthly-planning:2026-07', nextRevision: 1 });
    expect(first.items).toHaveLength(0);
    expect(first.periodStart).toBeNull();
    expect(first.notes.join()).toContain('初始化');
  });

  it('T03 未完成动作承接，已执行与已拒绝不承接', () => {
    const result = carryOverPlan({ previous: confirmedSession(), nextKey: 'monthly-planning:2026-08', nextRevision: 1 });
    const ids = result.items.map((item) => item.origin.itemId);
    expect(ids).toContain('a-accepted');
    expect(ids).toContain('a-deferred');
    expect(ids).toContain('a-partial');
    expect(ids).not.toContain('a-executed');
    expect(ids).not.toContain('a-rejected');
    expect(ids).toContain('cf-pending');
    expect(ids).not.toContain('cf-settled');
    expect(ids).toContain('res-1');
    expect(ids).toContain('policy-a@3');
  });

  it('T04 承接幂等：重复运行不产生重复项，且保留人工处理后的状态', () => {
    const first = carryOverPlan({ previous: confirmedSession(), nextKey: 'monthly-planning:2026-08', nextRevision: 1 });
    const resolved: CarriedItem[] = first.items.map((item, index) => index === 0 ? { ...item, status: 'resolved' as const } : item);
    const second = carryOverPlan({ previous: confirmedSession(), nextKey: 'monthly-planning:2026-08', nextRevision: 1 });
    const merged = mergeCarryOver(resolved, second.items);
    expect(merged).toHaveLength(first.items.length);
    expect(merged.filter((item) => item.status === 'resolved')).toHaveLength(1);
    const keys = merged.map((item) => carryOverKey(item.origin));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('T05 来源会话被修订后承接项置为 stale，且不会自动变成已解决', () => {
    const items = carryOverPlan({ previous: confirmedSession(), nextKey: 'monthly-planning:2026-08', nextRevision: 1 }).items;
    const stale = markCarryOverStale(items, new Map([['monthly-planning:2026-07', 3]]));
    expect(stale.every((item) => item.stale)).toBe(true);
    expect(stale.every((item) => item.status === 'open')).toBe(true);
    const unchanged = markCarryOverStale(items, new Map([['monthly-planning:2026-07', 2]]));
    expect(unchanged.every((item) => !item.stale)).toBe(true);
    expect(summarizeCarryOver(stale).stale).toBe(items.length);
  });

  it('T06 区间连续性：起点必须是上月快照时点，不一致时明确报错', () => {
    const previous = confirmedSession();
    expect(checkPeriodContinuity({ previous, nextReviewPeriodStart: '2026-07-15' }).ok).toBe(true);
    const mismatch = checkPeriodContinuity({ previous, nextReviewPeriodStart: '2026-07-01' });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.message).toContain('2026-07-15');
    expect(checkPeriodContinuity({ previous: null, nextReviewPeriodStart: null }).ok).toBe(true);
    expect(checkPeriodContinuity({ previous: null, nextReviewPeriodStart: '2026-06-15' }).ok).toBe(false);
  });

  it('T07 承接项不含金额权威结论，只引用来源（策略/研究/在途指令）', () => {
    const result = carryOverPlan({ previous: confirmedSession(), nextKey: 'monthly-planning:2026-08', nextRevision: 1 });
    const kinds = new Set(result.items.map((item) => item.kind));
    expect(kinds.has('policy')).toBe(true);
    expect(kinds.has('pending-settlement')).toBe(true);
    expect(result.items.every((item) => typeof item.detail !== 'string' || !/总资产/.test(item.detail))).toBe(true);
  });
});
