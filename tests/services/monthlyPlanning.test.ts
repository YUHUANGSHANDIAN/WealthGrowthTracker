import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyMonthlyPlanningState, findSession, parseMonthlyPlanningState, recordExecution, removeSession, summarizeMonthlyState, upsertPolicy, upsertSession,
} from '../../src/services/monthlyPlanning/storage';
import { attachmentKey, base64ToBytes, bytesToBase64, getAttachment, isAttachmentKey, putAttachment, removeAttachment, verifyAttachment } from '../../src/services/monthlyPlanning/attachments';
import { createDraftSession, transitionSession } from '../../src/domain/portfolio/session';
import type { InvestmentPolicy, MonthlyReview, Proposal } from '../../src/domain/portfolio/types';

const policy = (version = 1): InvestmentPolicy => ({
  id: 'policy-a', version, effectiveFrom: '2026-07-20', approvedByUser: true, targetAllocation: {}, riskLimits: [],
  liquidityFloor: null, minTradeAmount: null, minTradeShares: null, cooldownDays: null, feeRate: null,
  takeProfit: null, planLevelExecution: false,
});

const proposed = (): Proposal => ({
  id: 'p1', sessionKey: 'monthly-planning:2026-07', policyVersion: 1, createdAt: 'now', actions: [
    { id: 'a1', kind: 'buy', amount: 1_000, shares: null, triggers: [], evidence: [], rationale: 'r', constraintsApplied: [], residuals: [], blockers: [] },
  ], conflicts: [], dataStatus: 'green', riskStatus: 'green', summary: '',
});

function session(overrides: Partial<MonthlyReview> = {}): MonthlyReview {
  const base = createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-15', now: 'now' });
  return { ...base, state: 'planned', revision: 2, policyId: 'policy-a', policyVersion: 1, proposal: proposed(), ...overrides };
}

describe('月度理财持久化', () => {
  it('空值初始化，未来 schema 只读拒绝，重复会话键被拒绝', () => {
    expect(parseMonthlyPlanningState(null)).toEqual(emptyMonthlyPlanningState());
    expect(() => parseMonthlyPlanningState({ schemaVersion: 2, sessions: [], policies: [], assignmentRules: [] })).toThrow('更新版本');
    expect(() => parseMonthlyPlanningState({ schemaVersion: 1, sessions: [{ key: 'monthly-planning:2026-07' }, { key: 'monthly-planning:2026-07' }], policies: [], assignmentRules: [] })).toThrow('重复');
    expect(() => parseMonthlyPlanningState({ schemaVersion: 1, sessions: [{ key: 'monthly-planning:2026-7' }], policies: [], assignmentRules: [] })).toThrow('键无效');
  });
  it('会话只能升版，同版本内容变化必须递增 revision', () => {
    const state = upsertSession(emptyMonthlyPlanningState(), session());
    expect(findSession(state, 'monthly-planning:2026-07')?.revision).toBe(2);
    expect(() => upsertSession(state, session({ revision: 1 }))).toThrow('不能回退');
    expect(() => upsertSession(state, session({ revision: 2, note: '改了' }))).toThrow('内容不一致');
    const next = upsertSession(state, session({ revision: 3, note: '修订' }));
    expect(findSession(next, 'monthly-planning:2026-07')?.revision).toBe(3);
  });
  it('策略版本不能回退，执行回执必须引用已有动作且 ID 唯一', () => {
    let state = upsertPolicy(emptyMonthlyPlanningState(), policy(3));
    expect(() => upsertPolicy(state, policy(2))).toThrow('版本不能回退');
    state = upsertSession(state, session());
    const executed = recordExecution(state, 'monthly-planning:2026-07', { id: 'e1', proposalId: 'p1', actionId: 'a1', status: 'executed', executedAt: 'now', evidence: [] });
    expect(findSession(executed, 'monthly-planning:2026-07')?.executions).toHaveLength(1);
    expect(findSession(executed, 'monthly-planning:2026-07')?.revision).toBe(3);
    expect(() => recordExecution(executed, 'monthly-planning:2026-07', { id: 'e1', proposalId: 'p1', actionId: 'a1', status: 'executed', evidence: [] })).toThrow('重复');
    expect(() => recordExecution(executed, 'monthly-planning:2026-07', { id: 'e2', proposalId: 'p1', actionId: 'missing', status: 'executed', evidence: [] })).toThrow('不存在');
    expect(() => recordExecution(executed, 'monthly-planning:2026-08', { id: 'e3', proposalId: 'p1', actionId: 'a1', status: 'executed', evidence: [] })).toThrow('会话不存在');
  });
  it('删除会话按明确键，汇总统计可用', () => {
    const state = upsertSession(emptyMonthlyPlanningState(), session({ state: 'confirmed' }));
    expect(summarizeMonthlyState(state).confirmed).toBe(1);
    expect(removeSession(state, 'monthly-planning:2026-07').sessions).toHaveLength(0);
    expect(removeSession(state, 'monthly-planning:2026-09').sessions).toHaveLength(1);
  });
  it('确认流程与存储协作：确认后可登记回执并升版', () => {
    const planned = session();
    const confirmed = transitionSession(planned, 'confirmed', { now: 'now', baseDataRevision: 7 });
    const state = upsertSession(emptyMonthlyPlanningState(), confirmed);
    expect(findSession(state, confirmed.key)?.baseDataRevision).toBe(7);
  });
});

describe('附件库', () => {
  beforeEach(() => localStorage.clear());
  it('内容寻址：键含哈希、Base64 往返一致、校验通过', async () => {
    const bytes = new TextEncoder().encode('合成文档内容');
    const ref = await putAttachment({ name: '微信渠道.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes });
    expect(ref.key.startsWith('monthly-attach:')).toBe(true);
    expect(isAttachmentKey(ref.key)).toBe(true);
    expect(bytesToBase64(bytes)).toBe(bytesToBase64(base64ToBytes(bytesToBase64(bytes))));
    const roundTrip = await getAttachment(ref);
    expect(new TextDecoder().decode(roundTrip)).toBe('合成文档内容');
    expect((await verifyAttachment(ref)).ok).toBe(true);
  });
  it('同一内容重复入库得到同一键；哈希不符时拒绝使用', async () => {
    const bytes = new TextEncoder().encode('x');
    const first = await putAttachment({ name: 'a.txt', mime: 'text/plain', bytes });
    const second = await putAttachment({ name: 'a.txt', mime: 'text/plain', bytes });
    expect(second.key).toBe(first.key);
    await expect(getAttachment({ key: first.key, sha256: 'f'.repeat(64) })).rejects.toThrow('哈希不符');
  });
  it('拒绝非法键，删除只针对明确键', async () => {
    expect(() => attachmentKey('nope', 'a.txt')).toThrow();
    await expect(removeAttachment('monthly-attach:../evil.txt')).rejects.toThrow('引用无效');
    const bytes = new TextEncoder().encode('y');
    const ref = await putAttachment({ name: 'b.txt', mime: 'text/plain', bytes });
    await removeAttachment(ref.key);
    await expect(getAttachment(ref)).rejects.toThrow('附件不存在');
  });
});
