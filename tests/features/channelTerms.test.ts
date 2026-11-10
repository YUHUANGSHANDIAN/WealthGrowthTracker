import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/types';
import { CHANNEL_TERMS } from '../../src/constants/channelTerms';
import { buildChannelsCsv } from '../../src/utils/dataCsv';

const channels: Channel[] = [
  {
    id: 'alipay', name: '支付宝', emoji: '💙', amount: 0, color: '#000',
    isParent: true, isExpanded: true,
    children: [{ id: 'fund', name: '基金', emoji: '📊', amount: 80, color: '#00f', parentId: 'alipay' }],
  },
  { id: 'bank', name: '银行卡', emoji: '🏦', amount: 20, color: '#666', isParent: true, isExpanded: false, children: [] },
];

describe('渠道术语与导出', () => {
  it('CSV 保留机器列并区分子渠道和父渠道直接金额', () => {
    const csv = buildChannelsCsv(channels);
    expect(csv.header.slice(0, 7)).toEqual([
      'parentId', 'parentName', 'channelId', 'channelName', 'amount', 'percentage', 'snapshotDate',
    ]);
    expect(csv.header.slice(7)).toEqual(['channelPath', 'channelKind']);
    expect(csv.rows.find((row) => row[2] === 'fund')).toMatchObject({
      7: '支付宝 / 基金', 8: 'subchannel',
    });
    expect(csv.rows.find((row) => row[2] === 'bank')).toMatchObject({
      7: `银行卡 · ${CHANNEL_TERMS.parentDirect}`, 8: 'parent-direct',
    });
  });

  it('当前术语不把父渠道直接金额称为子渠道', () => {
    expect(CHANNEL_TERMS.parentDirect).not.toContain('叶子');
    expect(CHANNEL_TERMS.subchannel).toBe('子渠道');
  });
});
