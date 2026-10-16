import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyMonthlyPlanningState, findSession, parseMonthlyPlanningState, recordExecution, removeSession, summarizeMonthlyState, upsertPolicy, upsertSession,
} from '../../src/services/monthlyPlanning/storage';
import { attachmentKey, base64ToBytes, bytesToBase64, getAttachment, isAttachmentKey, putAttachment, removeAttachment, verifyAttachment } from '../../src/services/monthlyPlanning/attachments';
import {
  MAX_ARCHIVE_BYTES, buildAttachmentArchive, countExistingAttachments, importAttachmentArchive, parseAttachmentArchive,
} from '../../src/services/monthlyPlanning/attachmentArchive';
import { createDraftSession, transitionSession } from '../../src/domain/portfolio/session';
import type { InvestmentPolicy, MonthlyPlanningState, MonthlyReview, Proposal, SourceDocument } from '../../src/domain/portfolio/types';

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
  it('同 id 的新策略版本按版本追加，旧版本仍可查，同版本原地更新', () => {
    let state = upsertPolicy(emptyMonthlyPlanningState(), policy(1));
    state = upsertPolicy(state, policy(2));
    expect(state.policies.map((item) => item.version).sort()).toEqual([1, 2]);
    // 已确认会话记录的旧版本必须仍然查得到，否则会被健康检查误报“策略版本缺失”。
    expect(state.policies.find((item) => item.version === 1)).toBeDefined();
    state = upsertPolicy(state, { ...policy(2), cooldownDays: 5 });
    expect(state.policies).toHaveLength(2);
    expect(state.policies.find((item) => item.version === 2)?.cooldownDays).toBe(5);
    expect(() => upsertPolicy(state, policy(1))).toThrow('版本不能回退');
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

describe('含附件单文件归档', () => {
  beforeEach(() => localStorage.clear());

  const documentFor = (ref: { key: string; sha256: string }, name: string): SourceDocument => ({
    id: `doc:${ref.sha256.slice(0, 12)}`, relativePath: ref.key, sha256: ref.sha256, originalName: name,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', platform: 'wechat',
    importedAt: '2026-07-20T00:00:00.000Z', integrity: 'ok', parseState: 'parsed',
  });

  const stateWith = (documents: SourceDocument[]): MonthlyPlanningState => ({
    ...emptyMonthlyPlanningState(),
    sessions: [{
      ...createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-20', now: 'now' }),
      documents,
    }],
  });

  async function seed(): Promise<{ docx: DocumentRef; image: DocumentRef; state: MonthlyPlanningState }> {
    const docx = await putAttachment({ name: '微信渠道.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new TextEncoder().encode('合成渠道明细') });
    const image = await putAttachment({ name: '微信渠道.jpg', mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7]) });
    return {
      docx, image,
      state: stateWith([documentFor(docx, '微信渠道.docx'), documentFor(image, '微信渠道.jpg')]),
    };
  }

  type DocumentRef = { key: string; sha256: string };

  it('导出后可在空库恢复，内容哈希一致', async () => {
    const { docx, image, state } = await seed();
    const built = await buildAttachmentArchive(state, '2026-10-16T00:00:00.000Z');
    expect(built.attachmentCount).toBe(2);
    expect(built.totalBytes).toBeGreaterThan(0);

    const parsed = parseAttachmentArchive(built.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await removeAttachment(docx.key);
    await removeAttachment(image.key);
    expect(await countExistingAttachments(parsed.archive)).toEqual({ existing: 0, missing: 2 });
    const result = await importAttachmentArchive(parsed.archive);
    expect(result).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
    expect(new TextDecoder().decode(await getAttachment(docx))).toBe('合成渠道明细');
  });

  it('重复导入幂等：已存在且哈希一致的附件跳过而不是覆盖', async () => {
    const { state } = await seed();
    const parsed = parseAttachmentArchive((await buildAttachmentArchive(state, 'now')).text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await importAttachmentArchive(parsed.archive);
    const again = await importAttachmentArchive(parsed.archive);
    expect(again).toMatchObject({ imported: 0, skipped: 2, failed: 0 });
  });

  it('任一项哈希不符即整批拒绝，不写入任何附件', async () => {
    const { docx, image, state } = await seed();
    const parsed = parseAttachmentArchive((await buildAttachmentArchive(state, 'now')).text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await removeAttachment(docx.key);
    await removeAttachment(image.key);
    const tampered = structuredClone(parsed.archive);
    tampered.attachments[1]!.data = bytesToBase64(new TextEncoder().encode('被篡改的内容'));
    await expect(importAttachmentArchive(tampered)).rejects.toThrow('整批拒绝写入');
    // 第一个附件也不能落盘——先校验、后写入。
    await expect(getAttachment(docx)).rejects.toThrow('附件不存在');
  });

  it('导出时附件缺失会中止并列出名字', async () => {
    const { docx, state } = await seed();
    await removeAttachment(docx.key);
    await expect(buildAttachmentArchive(state, 'now')).rejects.toThrow('无法读取');
  });

  it('解析阶段拒绝非法结构、大小不符与超限文件', async () => {
    const { state } = await seed();
    const good = parseAttachmentArchive((await buildAttachmentArchive(state, 'now')).text);
    expect(good.ok).toBe(true);
    if (!good.ok) return;

    expect(parseAttachmentArchive('不是 JSON')).toMatchObject({ ok: false, error: '不是有效的 JSON 文件' });
    expect(parseAttachmentArchive(JSON.stringify({ kind: 'other', schemaVersion: 1, documents: [], attachments: [] })))
      .toMatchObject({ ok: false, error: expect.stringContaining('kind') });
    expect(parseAttachmentArchive(JSON.stringify({ ...good.archive, schemaVersion: 99 })))
      .toMatchObject({ ok: false, error: expect.stringContaining('schemaVersion') });
    expect(parseAttachmentArchive('x'.repeat(MAX_ARCHIVE_BYTES + 1)))
      .toMatchObject({ ok: false, error: expect.stringContaining('上限') });

    const oversized = structuredClone(good.archive);
    oversized.attachments[0]!.bytes += 1;
    expect(parseAttachmentArchive(JSON.stringify(oversized))).toMatchObject({ ok: false, error: expect.stringContaining('声明大小与实际内容不一致') });

    const badBase64 = structuredClone(good.archive);
    badBase64.attachments[0]!.data = '不是 base64!!';
    expect(parseAttachmentArchive(JSON.stringify(badBase64))).toMatchObject({ ok: false, error: expect.stringContaining('base64') });
  });

  it('归档只含附件键与哈希，不含绝对路径或凭据', async () => {
    const { state } = await seed();
    const parsed = parseAttachmentArchive((await buildAttachmentArchive(state, 'now')).text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const entry of parsed.archive.attachments) expect(isAttachmentKey(entry.key)).toBe(true);
    for (const document of parsed.archive.documents) {
      expect(isAttachmentKey(document.key)).toBe(true);
      expect(document.key.startsWith('/')).toBe(false);
    }
    const text = JSON.stringify(parsed.archive);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(text).not.toMatch(/\b(?:gh[pousr]|sk-|github_pat_)[A-Za-z0-9_-]{10,}/);
  });
});
