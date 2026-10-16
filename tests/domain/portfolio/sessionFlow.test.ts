import { describe, expect, it } from 'vitest';
import {
  EXTRACTED_HOLDING_PREFIX, advanceSession, clearAutoExtractedFacts, confirmBlockers, createDraftSession,
} from '../../../src/domain/portfolio/session';
import type { Holding, HoldingObservation, MonthlyReview, Proposal } from '../../../src/domain/portfolio/types';

const draft = (overrides: Partial<MonthlyReview> = {}): MonthlyReview => ({
  ...createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-20', now: 'now' }),
  ...overrides,
});

const proposal = (policyVersion = 1): Proposal => ({
  id: 'p1', sessionKey: 'monthly-planning:2026-07', policyVersion, createdAt: 'now', actions: [],
  conflicts: [], dataStatus: 'green', riskStatus: 'green', summary: '',
});

const holding = (id: string, platform: Holding['platform'] = 'wechat'): Holding => ({
  id, platform, parentChannelId: 'channel-1', originalName: '合成持仓', currency: 'CNY',
  productType: 'fund', exposureTags: [],
});

const observation = (holdingId: string): HoldingObservation => ({
  id: `obs:${holdingId}`, holdingId, sessionKey: 'monthly-planning:2026-07', shares: null,
  marketValue: 100, nav: null, evidence: [], quality: { source: 'evidence', attribution: 'conditional', valuation: 'observed', time: 'observed', review: 'pending' },
});

describe('会话状态推进', () => {
  it('沿合法边推进并且不跳级', () => {
    expect(advanceSession(draft(), 'extracting', { now: 'now' }).state).toBe('extracting');
    expect(advanceSession(draft(), 'reviewing', { now: 'now' }).state).toBe('reviewing');
    expect(advanceSession(draft(), 'planned', { now: 'now' }).state).toBe('planned');
    const confirmed = advanceSession(draft({ proposal: proposal(), policyId: 'policy-a', policyVersion: 1 }), 'confirmed', {
      now: 'now', baseDataRevision: 3,
    });
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.baseDataRevision).toBe(3);
  });

  it('已在目标状态时幂等，非法目标抛错', () => {
    const ready = draft({ state: 'ready' });
    expect(advanceSession(ready, 'ready', { now: 'now' })).toBe(ready);
    expect(() => advanceSession(draft({ state: 'archived' }), 'draft', { now: 'now' })).toThrow('不允许的状态流转：archived → draft');
    expect(advanceSession(draft(), 'blocked', { now: 'now' }).state).toBe('blocked');
  });

  it('确认时仍然执行原有守卫：缺候选或缺数据版本都拒绝', () => {
    expect(() => advanceSession(draft({ policyId: 'policy-a', policyVersion: 1 }), 'confirmed', { now: 'now', baseDataRevision: 3 }))
      .toThrow('缺少候选方案');
    expect(() => advanceSession(draft({ proposal: proposal(), policyId: 'policy-a', policyVersion: 1 }), 'confirmed', { now: 'now' }))
      .toThrow('缺少主应用数据版本');
  });
});

describe('确认前置条件', () => {
  const clean = { issues: [] as const, currentPolicyVersion: 1 };

  it('没有会话、没有候选、缺策略版本、有错误级问题、策略已更新都给出可照做的原因', () => {
    expect(confirmBlockers({ session: null, issues: [], currentPolicyVersion: null })).toEqual(['请先创建本月会话']);
    expect(confirmBlockers({ session: draft(), ...clean })).toEqual([
      '还没有候选方案，请先点「生成候选」', '会话还没有绑定策略版本，请先点「生成候选」',
    ]);
    const withProposal = draft({ proposal: proposal(), policyId: 'policy-a', policyVersion: 1 });
    expect(confirmBlockers({ session: withProposal, issues: [], currentPolicyVersion: 1 })).toEqual([]);
    expect(confirmBlockers({
      session: withProposal, currentPolicyVersion: 1,
      issues: [{ code: 'x', severity: 'error', message: '持仓父渠道不存在' }],
    }).join()).toContain('错误级问题');
    expect(confirmBlockers({ session: withProposal, issues: [], currentPolicyVersion: 2 }).join()).toContain('策略已更新到 v2');
    expect(confirmBlockers({ session: draft({ state: 'confirmed' }), ...clean })).toEqual(['月度计划已确认，无需重复确认']);
  });
});

describe('清空自动提取的候选', () => {
  const auto = `${EXTRACTED_HOLDING_PREFIX}doc:abc123:0:1`;
  const withFacts = (state: MonthlyReview['state'] = 'reviewing'): MonthlyReview => draft({
    state,
    proposal: proposal(),
    holdings: [holding(auto), holding('holding:manual-1', 'manual')],
    observations: [observation(auto), observation('holding:manual-1')],
    cashFlows: [],
  });

  it('只删除自动持仓与它们的观察，保留手工持仓、资料与回执', () => {
    const result = clearAutoExtractedFacts(withFacts(), 'now');
    expect(result.removedHoldings).toBe(1);
    expect(result.removedObservations).toBe(1);
    expect(result.session.holdings.map((item) => item.id)).toEqual(['holding:manual-1']);
    expect(result.session.observations.map((item) => item.holdingId)).toEqual(['holding:manual-1']);
    expect(result.session.proposal).toBeNull();
    expect(result.session.documents).toEqual([]);
  });

  it('ready 退回 reviewing，完整会话状态不再允许清空', () => {
    expect(clearAutoExtractedFacts(withFacts('ready'), 'now').session.state).toBe('reviewing');
    expect(clearAutoExtractedFacts(withFacts('reviewing'), 'now').session.state).toBe('reviewing');
    expect(() => clearAutoExtractedFacts(withFacts('confirmed'), 'now')).toThrow('请先删除会话');
    expect(() => clearAutoExtractedFacts(withFacts('planned'), 'now')).toThrow('请先删除会话');
  });
});
