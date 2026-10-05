import { describe, it, expect } from 'vitest';
import type { Channel } from '../../src/types';
import { buildAssetComposition, normalizeFinancialReport } from '../../src/features/reports/normalize';
import { totalAssets } from '../../src/utils/channels';

function parent(id: string, name: string, children: Channel['children'] = [], amount = 0): Channel {
  return { id, name, emoji: '💰', amount, color: '#000', isParent: true, isExpanded: false, children };
}

describe('Report 层级资产构成（Schema v3）', () => {
  it('父渠道 rollup + 子渠道 breakdown，父子不 double-count', () => {
    // 支付宝：余额 20 + 余额宝 80 = 100；银行卡：100；总资产 200
    const channels: Channel[] = [
      parent('alipay', '支付宝', [
        { id: 'a1', name: '余额', emoji: '💰', amount: 20, color: '#000', parentId: 'alipay' },
        { id: 'a2', name: '余额宝', emoji: '💎', amount: 80, color: '#000', parentId: 'alipay' },
      ]),
      parent('bank', '银行卡', [], 100),
    ];
    const total = totalAssets(channels);
    expect(total).toBe(200);

    const comp = buildAssetComposition(channels, total);
    expect(comp.totalAmount).toBe(200);

    const alipay = comp.parents.find((p) => p.id === 'alipay')!;
    expect(alipay.amount).toBe(100);
    expect(alipay.percentageOfTotal).toBe(50);
    expect(alipay.children).toHaveLength(2);
    // 余额宝占父渠道 80%，占总资产 40%
    const yuebao = alipay.children.find((c) => c.id === 'a2')!;
    expect(yuebao.percentageOfParent).toBe(80);
    expect(yuebao.percentageOfTotal).toBe(40);

    // 父渠道金额之和 = 总资产（不能得到 300）
    const parentSum = comp.parents.reduce((a, p) => a + p.amount, 0);
    expect(parentSum).toBe(200);
    expect(parentSum).not.toBe(300);
  });

  it('旧 channels snapshot → 层级成功恢复', () => {
    const channels: Channel[] = [
      parent('alipay', '支付宝', [{ id: 'a1', name: '余额宝', emoji: '💎', amount: 50, color: '#000', parentId: 'alipay' }]),
    ];
    const report = normalizeFinancialReport({
      id: 'r1', reportType: 'monthly', startDate: '2026-07-01', endDate: '2026-07-31',
      title: '2026年7月月度财务报告', totalAmount: 50, changeAmount: 0, changePercentage: 0,
      channelDetails: [], isArchived: false, createdAt: '',
      channels,
    });
    expect(report.reportSchemaVersion).toBe(4);
    expect(report.assetComposition).toBeDefined();
    expect(report.assetComposition!.parents[0]!.children).toHaveLength(1);
  });

  it('只有 flat channelDetails（无 channels snapshot）→ 不猜父关系，有 warning', () => {
    const report = normalizeFinancialReport({
      id: 'r2', reportType: 'monthly', startDate: '2026-07-01', endDate: '2026-07-31',
      title: '旧报告', totalAmount: 100, changeAmount: 0, changePercentage: 0,
      channelDetails: [
        { id: 'x', name: '余额宝', emoji: '💰', amount: 80, isParent: false, children: [], percentage: 80 },
        { id: 'y', name: '基金', emoji: '📊', amount: 20, isParent: false, children: [], percentage: 20 },
      ],
      isArchived: false, createdAt: '',
    });
    expect(report.assetComposition).toBeUndefined();
    expect(report.compositionWarnings?.length).toBeGreaterThan(0);
  });

  it('report schema v3 幂等：重复 normalize 不变', () => {
    const channels: Channel[] = [parent('alipay', '支付宝', [{ id: 'a1', name: '余额宝', emoji: '💎', amount: 50, color: '#000', parentId: 'alipay' }])];
    const base = {
      id: 'r3', reportType: 'monthly' as const, startDate: '2026-07-01', endDate: '2026-07-31',
      title: '2026年7月月度财务报告', totalAmount: 50, changeAmount: 0, changePercentage: 0,
      channelDetails: [], isArchived: false, createdAt: '', channels,
    };
    const once = normalizeFinancialReport(base);
    const twice = normalizeFinancialReport(once);
    expect(twice).toEqual(once);
  });
});
