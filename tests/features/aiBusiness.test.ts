import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageService } from '../../src/services/storage';
import { useAppStore } from '../../src/store/appStore';
import { useAIConnectionStore } from '../../src/store/aiConnectionStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { setAIEnabled } from '../../src/services/ai/client';
import {
  confirmAIChange,
  prepareAIChange,
  prepareAIOperation,
  runAuthorizedAI,
  validateExplanation,
  validateHealthAssistantReply,
} from '../../src/services/ai/business';
import { isAnnotationStale, listAIAnnotations, saveAIAnnotation } from '../../src/services/ai/annotations';
import type { Channel, FinancialReport } from '../../src/types';
import { todayString } from '../../src/utils/date';
import { checkDataHealth } from '../../src/utils/dataHealth';

const channels: Channel[] = [{
  id: 'bank', name: '银行', emoji: '🏦', amount: 0, color: '#000', isParent: true, isExpanded: false,
  children: [{ id: 'bank-balance', name: '活期', emoji: '', color: '#000', amount: 42, parentId: 'bank' }],
}];
const report: FinancialReport = {
  id: 'report-1', revision: 2, totalAmount: 5_000, dataAsOf: '2026-10-12',
} as FinancialReport;
const selection = { includeChannels: true, includeHistory: false, includeLottery: false } as const;

beforeEach(async () => {
  useAppStore.setState({
    hydrated: true, recoveryError: null, maintenanceLabel: null,
    channels, history: [], reports: [], levelAchievements: [],
    goalAchieved: { hasAchievedGoal: false }, toasts: [],
  });
  vi.spyOn(storageService, 'flush').mockResolvedValue();
  vi.spyOn(storageService, 'getDesktopManager').mockReturnValue(null);
  useWorkspaceStore.setState({ amountsHidden: false });
  await setAIEnabled(true);
  useAIConnectionStore.setState({
    enabled: true, busy: false, connectionRevision: 9, activeProfileId: 'p1',
    profiles: [{
      profileId: 'p1', providerId: 'gateway', authKind: 'api-key', label: '测试网关', modelId: 'm1',
      state: 'configured', endpoint: 'https://gateway.example.com/v1', enabled: true,
      credentialRef: 'profile:p1', credentialPersisted: false, configRevision: 1,
      capabilities: { text: true, vision: false, research: true }, health: 'healthy',
    }],
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await setAIEnabled(false);
  useAIConnectionStore.setState({ enabled: false, activeProfileId: null, profiles: [], connectionRevision: 0 });
  useAppStore.setState({ hydrated: false, maintenanceLabel: null });
});

describe('trusted AI business operations', () => {
  it('accepts explanations that only cite authorized facts', () => {
    const operation = prepareAIOperation('report-interpretation', selection, '解释当前资产');
    const factId = operation.pack.facts[0]!.factId;
    const valid = { summary: '概览', observations: [{ text: '银行活期余额', factIds: [factId] }], limitations: ['仅覆盖当前快照'] };
    expect(validateExplanation(JSON.stringify(valid), operation.pack).observations[0]?.factIds).toEqual([factId]);
    expect(() => validateExplanation(JSON.stringify({ ...valid, observations: [{ text: '伪造', factIds: ['forged.fact'] }] }), operation.pack)).toThrow('未授权');
    expect(() => validateExplanation(JSON.stringify({ ...valid, extra: true }), operation.pack)).toThrow('结构无效');
    expect(() => validateExplanation('{"summary": "截断"', operation.pack)).toThrow('完整 JSON');
  });

  it('expires a prepared operation after any local data change', async () => {
    const operation = prepareAIOperation('analysis-question', selection, '区间发生了什么');
    useAppStore.setState({ history: [{ date: '2026-10-11', totalAmount: 1 }] });
    await expect(runAuthorizedAI(operation)).rejects.toThrow('过期');
  });

  it('refuses to prepare operations while amounts are hidden', () => {
    useWorkspaceStore.setState({ amountsHidden: true });
    expect(() => prepareAIOperation('report-interpretation', selection, '解释')).toThrow('隐私');
  });

  it('turns an entry draft into a confirmable proposal limited to authorized channels', async () => {
    const operation = prepareAIOperation('entry-draft', { ...selection, includeAmounts: false }, '把活期更新为 100');
    const draft = { date: todayString(), changes: [{ parentId: 'bank', childId: 'bank-balance', amount: 100 }], warnings: [] };
    const change = prepareAIChange(JSON.stringify(draft), operation);
    expect(change.requiresConfirmation).toBe(true);
    expect(change.proposal.changes[0]).toMatchObject({ parentId: 'bank', childId: 'bank-balance', before: 42, after: 100 });
    await confirmAIChange(change);
    const committed = useAppStore.getState();
    expect(committed.channels[0]?.children?.[0]?.amount).toBe(100);
    expect(committed.history[committed.history.length - 1]).toMatchObject({ date: todayString(), totalAmount: 100 });
    await expect(confirmAIChange(change)).rejects.toThrow('未经校验');
  });

  it('rejects entry drafts for unauthorized channels or historic dates', () => {
    const operation = prepareAIOperation('entry-draft', { ...selection, includeAmounts: false }, '更新余额');
    const base = { date: todayString(), changes: [{ parentId: 'other', amount: 1 }], warnings: [] };
    expect(() => prepareAIChange(JSON.stringify(base), operation)).toThrow('未授权渠道');
    expect(() => prepareAIChange(JSON.stringify({ ...base, date: '2020-01-01', changes: [{ parentId: 'bank', childId: 'bank-balance', amount: 1 }] }), operation)).toThrow('今天');
    expect(() => prepareAIChange(JSON.stringify({ changes: base.changes }), operation)).toThrow('结构');
    expect(() => prepareAIChange(JSON.stringify({ date: todayString(), changes: [{ parentId: 'bank', childId: 'bank-balance', amount: -5 }], warnings: [] }), operation)).toThrow('不允许');
  });

  it('stores annotations separately and marks them stale after a report revision change', async () => {
    useAppStore.setState({ reports: [report] });
    const operation = prepareAIOperation('report-interpretation', { reportId: 'report-1', includeChannels: false, includeHistory: false, includeLottery: false }, '解释报告');
    const factId = operation.pack.facts[0]!.factId;
    const explanation = { summary: '总结', observations: [{ text: '观察', factIds: [factId] }], limitations: [] };
    await expect(saveAIAnnotation(operation, { ...explanation, observations: [{ text: '伪造', factIds: ['nope'] }] })).rejects.toThrow();
    const saved = await saveAIAnnotation(operation, explanation);
    expect(saved).toMatchObject({ reportId: 'report-1', reportRevision: 2, profileId: 'p1', modelId: 'm1' });
    const listed = await listAIAnnotations('report-1');
    expect(listed).toHaveLength(1);
    expect(isAnnotationStale(listed[0]!)).toBe(false);
    useAppStore.setState({ reports: [{ ...report, revision: 3 }] });
    expect(isAnnotationStale(listed[0]!)).toBe(true);
    expect(useAppStore.getState().reports[0]?.totalAmount).toBe(5_000);
  });

  it('bounds health conversation context and rejects forged facts or actions', () => {
    useAppStore.setState({
      history: [
        { date: '2026-01-01', totalAmount: 1 },
        { date: '2026-01-01', totalAmount: 2 },
      ],
    });
    const real = checkDataHealth([], useAppStore.getState().history).issues.find((item) => item.fix === 'dedupe-history')!;
    const operation = prepareAIOperation('data-health-assistant', {
      includeChannels: false,
      includeHistory: false,
      includeLottery: false,
      includeAmounts: false,
      includeDataHealth: true,
      healthIssueId: real.id,
      healthIssueFingerprint: real.fingerprint,
      includeHealthEvidence: false,
    }, '为什么提示重复日期？', Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      text: `最近消息 ${index}`,
    })));
    expect(operation.pack.facts.some((fact) => fact.factId === 'health.issue.actions')).toBe(true);
    expect(operation.pack.facts.some((fact) => /^\d{3,}$/.test(fact.value))).toBe(false);
    const valid = {
      message: '这是重复日期提示。',
      citations: [{ text: '本地规则检测到重复日期', factIds: ['health.duplicateDates'] }],
      limitations: ['不会自动决定保留哪一条'],
      proposal: {
        operation: 'preview-existing-action',
        actionId: 'dedupe-history',
        issueId: real.id,
        rationale: '只预览当前问题对应的去重',
        warnings: ['会移除同日期的旧记录'],
        confidence: 'high',
      },
    };
    expect(validateHealthAssistantReply(JSON.stringify(valid), operation.pack, operation).proposal?.actionId).toBe('dedupe-history');
    expect(() => validateHealthAssistantReply(JSON.stringify({
      ...valid,
      citations: [{ text: '伪造', factIds: ['forged.fact'] }],
    }), operation.pack, operation)).toThrow('未授权');
    expect(() => validateHealthAssistantReply(JSON.stringify({
      ...valid,
      proposal: { ...valid.proposal, actionId: 'remove-orphans' },
    }), operation.pack, operation)).toThrow('未提供');
  });
});
