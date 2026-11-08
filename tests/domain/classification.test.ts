import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/types';
import type { Holding, MonthlyPlanningState } from '../../src/domain/portfolio/types';
import { createFinanceDraftSession } from '../../src/domain/portfolio/session';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import {
  classifyFundHolding,
  createClassificationEvent,
  emptyAssetClassificationState,
  parseAssetClassificationState,
  projectMonthlyPlanningClassification,
  verifyAssetClassificationIntegrity,
} from '../../src/domain/assets/classification';
import { canonicalJson, sha256Text } from '../../src/utils/canonicalHash';
import {
  applyAlipayClassificationMigration,
  buildAlipayClassificationMigrationPlan,
  revertAlipayClassificationMigration,
} from '../../src/domain/assets/classificationMigration';
import { defaultChannels } from '../../src/constants/defaults';
import { checkClassificationHealth } from '../../src/utils/dataHealth';

const channels: Channel[] = [{
  id: 'alipay', name: '支付宝', emoji: '💙', amount: 0, color: '#3b82f6', isParent: true, isExpanded: true,
  children: [
    { id: 'alipay_fund', name: '基金', emoji: '📊', amount: 150, color: '#3b82f6', parentId: 'alipay' },
    { id: 'alipay_gold', name: '黄金', emoji: '🥇', amount: 50, color: '#d97706', parentId: 'alipay' },
  ],
}, {
  id: 'jd_finance', name: '京东金融', emoji: '💼', amount: 0, color: '#f43f5e', isParent: true, isExpanded: false,
  children: [{ id: 'jd_gold', name: '黄金', emoji: '🥇', amount: 20, color: '#d97706', parentId: 'jd_finance' }],
}];

function holding(id: string, name: string, fundCode: string, parentChannelId = 'alipay'): Holding {
  return {
    id, platform: parentChannelId === 'alipay' ? 'alipay' : 'wechat', parentChannelId,
    fundCode, originalName: name, currency: 'CNY', productType: 'fund', exposureTags: [],
  };
}

function planningWith(holdings: Holding[]): MonthlyPlanningState {
  const draft = createFinanceDraftSession({
    taskKind: 'fund-analysis', taskId: 'classification-test', planningMonth: '2026-11',
    timezone: 'Asia/Shanghai', today: '2026-11-04', now: '2026-11-04T00:00:00.000Z',
  });
  return {
    ...emptyMonthlyPlanningState(),
    sessions: [{
      ...draft,
      holdings,
      observations: holdings.map((item, index) => ({
        id: `obs:${item.id}`, holdingId: item.id, sessionKey: draft.key,
        shares: '10', marketValue: 10 + index, nav: '1', evidence: [],
        quality: { source: 'evidence', attribution: 'conditional', valuation: 'observed', time: 'observed', review: 'pending' },
      })),
    }],
  };
}

describe('资产分类领域', () => {
  it('新安装支付宝使用银行黄金，其他平台黄金名称不变', () => {
    const defaults = defaultChannels();
    expect(defaults.find((channel) => channel.id === 'alipay')?.children?.find((child) => child.id === 'alipay_gold')?.name).toBe('银行黄金');
    expect(defaults.find((channel) => channel.id === 'jd_finance')?.children?.find((child) => child.id === 'jd_gold')?.name).toBe('黄金');
  });

  it('黄金 ETF 联接保持基金产品并增加黄金敞口', () => {
    const result = classifyFundHolding({
      name: '合成黄金ETF联接A(示例)', fundCode: '000001', parentChannelId: 'alipay',
      exposureTags: [], productType: 'fund',
    });
    expect(result).toMatchObject({
      childChannelId: 'alipay_fund', productKind: 'fund-etf-feeder',
      shareClass: 'A', exposureTags: ['gold'], amountBasis: 'holding-observation',
    });
  });

  it('其他平台只增加黄金敞口，不移动基金渠道', () => {
    const result = classifyFundHolding({
      name: '合成黄金基金C', fundCode: '000002', parentChannelId: 'wechat',
      exposureTags: [], productType: 'fund',
    });
    expect(result.childChannelId).toBeUndefined();
    expect(result.exposureTags).toEqual(['gold']);
    expect(result.shareClass).toBe('C');
  });

  it('分类投影不修改原任务修订', async () => {
    const original = planningWith([holding('h1', '合成黄金ETF联接A', '000001')]);
    const event = await createClassificationEvent({
      kind: 'holding-reclassify', target: { type: 'holding', id: 'h1', taskId: original.sessions[0]!.key },
      before: null,
      after: { childChannelId: 'alipay_fund', productKind: 'fund-etf-feeder', shareClass: 'A', exposureTags: ['gold'], amountBasis: 'holding-observation' },
      source: 'user-confirmed', evidenceIds: ['doc:evidence'], classifiedAt: '2026-11-04T00:00:00.000Z', reason: '合成测试',
    });
    const state = { ...emptyAssetClassificationState(), events: [event] };
    const projected = projectMonthlyPlanningClassification(original, state);
    expect(projected.sessions[0]?.holdings[0]?.childChannelId).toBe('alipay_fund');
    expect(projected.sessions[0]?.holdings[0]?.exposureTags).toEqual(['gold']);
    expect(original.sessions[0]?.holdings[0]?.childChannelId).toBeUndefined();
    expect(original.sessions[0]?.holdings[0]?.exposureTags).toEqual([]);
  });

  it('迁移计划金额守恒、只改支付宝，并保留京东名称', async () => {
    const planning = planningWith([
      holding('h1', '合成黄金ETF联接A', '000001'),
      holding('h2', '合成黄金ETF联接C', '000002'),
    ]);
    const plan = buildAlipayClassificationMigrationPlan({
      channels, history: [], reports: [], planning, classifications: emptyAssetClassificationState(),
      now: '2026-11-04T01:00:00.000Z',
    });
    expect(plan.status).toBe('ready');
    expect(plan.invariant.totalBefore).toBe(220);
    expect(plan.invariant.totalAfter).toBe(220);
    expect(plan.invariant.totalDelta).toBe(0);
    expect(plan.changes.some((change) => change.target.id === 'jd_gold')).toBe(false);
    expect(plan.changes.some((change) => change.target.id === 'alipay_gold' && change.after.displayName === '银行黄金')).toBe(true);
    const applied = await applyAlipayClassificationMigration({
      plan, state: emptyAssetClassificationState(), backupSha256: 'a'.repeat(64),
      classifiedAt: '2026-11-04T01:10:00.000Z',
    });
    expect(applied.migrations['alipay-gold-classification-v1']).toBeDefined();
    expect(applied.migrations['alipay-gold-classification-v1']?.status).toBe('applied');
    expect(applied.events.length).toBe(plan.changes.length);
    await expect(verifyAssetClassificationIntegrity(applied)).resolves.toMatchObject({ changed: false });
    const rerun = buildAlipayClassificationMigrationPlan({
      channels, history: [], reports: [], planning, classifications: applied,
      now: '2026-11-04T02:00:00.000Z',
    });
    expect(rerun.status).toBe('applied');
    expect(rerun.changes).toHaveLength(0);
    const reverted = await revertAlipayClassificationMigration({
      state: applied,
      at: '2026-11-04T03:00:00.000Z',
    });
    expect(reverted.migrations['alipay-gold-classification-v1']?.status).toBe('reversed');
    expect(reverted.events.filter((event) => event.kind === 'reversal')).toHaveLength(plan.changes.length);
    const readyAgain = buildAlipayClassificationMigrationPlan({
      channels, history: [], reports: [], planning, classifications: reverted,
      now: '2026-11-04T04:00:00.000Z',
    });
    expect(readyAgain.status).toBe('ready');
  });

  it('自定义黄金渠道名不被迁移覆盖', () => {
    const custom = channels.map((channel) => channel.id === 'alipay'
      ? { ...channel, children: channel.children!.map((child) => child.id === 'alipay_gold' ? { ...child, name: '我的黄金' } : child) }
      : channel);
    const plan = buildAlipayClassificationMigrationPlan({
      channels: custom, history: [], reports: [], planning: planningWith([]),
      classifications: emptyAssetClassificationState(), now: '2026-11-04T01:00:00.000Z',
    });
    const channelChange = plan.changes.find((change) => change.target.id === 'alipay_gold');
    expect(channelChange?.kind).toBe('product-classify');
    expect(channelChange?.after.displayName).toBe('我的黄金');
  });

  it('同父级重复基金代码保留原持仓并进入待核对', () => {
    const plan = buildAlipayClassificationMigrationPlan({
      channels, history: [], reports: [],
      planning: planningWith([
        holding('h1', '合成黄金ETF联接A', '000001'),
        holding('h2', '合成黄金ETF联接A(重复表示)', '000001'),
      ]),
      classifications: emptyAssetClassificationState(), now: '2026-11-04T01:00:00.000Z',
    });
    expect(plan.pending.filter((item) => item.holdingId === 'h1' || item.holdingId === 'h2')).toHaveLength(2);
    expect(plan.changes.some((change) => change.target.id === 'h1' || change.target.id === 'h2')).toBe(false);
  });

  it('未来分类 schema 失败关闭', () => {
    expect(() => parseAssetClassificationState({ schemaVersion: 2, events: [], migrations: {} })).toThrow('更新版本');
  });

  it('新建事件规范化数组并支持持久化往返校验', async () => {
    const event = await createClassificationEvent({
      kind: 'product-classify',
      target: { type: 'product', id: 'product:test' },
      before: null,
      after: {
        productKind: 'other',
        exposureTags: ['liquidity', 'gold', 'gold'],
        amountBasis: 'unallocated',
      },
      source: 'rule-proposed',
      evidenceIds: ['doc:z', 'doc:a', 'doc:z'],
      classifiedAt: '2026-11-04T00:00:00.000Z',
      reason: '合成测试',
    });
    expect(event.evidenceIds).toEqual(['doc:a', 'doc:z']);
    expect(event.after?.exposureTags).toEqual(['gold', 'liquidity']);
    const parsed = parseAssetClassificationState(JSON.parse(JSON.stringify({
      ...emptyAssetClassificationState(),
      events: [event],
    })));
    await expect(verifyAssetClassificationIntegrity(parsed)).resolves.toMatchObject({ changed: false });
  });

  it('已有事件按原始数组顺序解析后仍通过哈希校验', async () => {
    const id = 'legacy-event';
    const input = {
      kind: 'holding-reclassify' as const,
      target: { type: 'holding' as const, id: 'holding-1', taskId: 'task-1' },
      before: { productKind: 'fund-other' as const, exposureTags: ['liquidity', 'gold'] },
      after: { childChannelId: 'fund', productKind: 'fund-etf-feeder' as const, exposureTags: ['gold', 'liquidity'] },
      source: 'user-confirmed' as const,
      evidenceIds: ['doc:z', 'doc:a'],
      classifiedAt: '2026-11-04T00:00:00.000Z',
      reason: '已部署数据的哈希以当时数组顺序计算',
    };
    const event = { ...input, id, contentHash: await sha256Text(canonicalJson({ ...input, id })) };
    const parsed = parseAssetClassificationState({
      schemaVersion: 1,
      migrations: {},
      events: [event],
    });
    expect(parsed.events[0]?.evidenceIds).toEqual(['doc:z', 'doc:a']);
    expect(parsed.events[0]?.after?.exposureTags).toEqual(['gold', 'liquidity']);
    await expect(verifyAssetClassificationIntegrity(parsed)).resolves.toMatchObject({ changed: false });
  });

  it('分类事件被篡改后仍失败关闭', async () => {
    const event = await createClassificationEvent({
      kind: 'product-classify',
      target: { type: 'channel', id: 'channel-1' },
      before: null,
      after: { productKind: 'other', exposureTags: ['gold'] },
      source: 'user-confirmed',
      evidenceIds: ['doc:1'],
      classifiedAt: '2026-11-04T00:00:00.000Z',
      reason: '合成测试',
    });
    const parsed = parseAssetClassificationState({
      schemaVersion: 1,
      migrations: {},
      events: [{ ...event, reason: '被篡改' }],
    });
    await expect(verifyAssetClassificationIntegrity(parsed)).rejects.toThrow('内容哈希不符');
  });

  it('分类健康报告缺失迁移、基金归属和黄金敞口', () => {
    const planning = planningWith([holding('h1', '合成黄金ETF联接A', '000001')]);
    const issues = checkClassificationHealth(channels, planning, emptyAssetClassificationState());
    expect(issues.some((issue) => issue.title === '支付宝分类迁移尚未应用')).toBe(true);
    expect(issues.some((issue) => issue.title === '黄金产品缺少风险敞口')).toBe(true);
    expect(issues.some((issue) => issue.title === '支付宝基金缺少基金叶子归属')).toBe(true);
    expect(issues.every((issue) => issue.fix === null)).toBe(true);
  });

  it('同代码不同份额保留独立证据，并生成可逐项处理的问题', () => {
    const planning = planningWith([
      { ...holding('h1', '合成基金A', '123456'), shareClass: 'A' },
      { ...holding('h2', '合成基金C', '123456'), shareClass: 'C' },
    ]);
    planning.sessions[0]!.holdings[1] = {
      ...planning.sessions[0]!.holdings[1]!,
      childChannelId: 'alipay_fund',
    };
    const issues = checkClassificationHealth(channels, planning, emptyAssetClassificationState());
    const duplicate = issues.find((issue) => issue.title === '同渠道重复基金代码');
    expect(duplicate).toBeDefined();
    expect(duplicate?.evidenceRefs.filter((reference) => reference.kind === 'holding')).toHaveLength(2);
    expect(duplicate?.impact.financialDataChanged).toBe(false);
    expect(duplicate?.allowedResolutions).toContain('distinct-identity');
    expect(duplicate?.id).not.toBe('classification:rule-duplicate');
  });
});
