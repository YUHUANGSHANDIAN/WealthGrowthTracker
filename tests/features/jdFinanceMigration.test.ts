import { describe, it, expect } from 'vitest';
import type { Channel } from '../../src/types';
import { migrateChannelsV15, JD_FINANCE_CHILDREN } from '../../src/services/migration';
import { defaultChannels } from '../../src/constants/defaults';

function channel(id: string, name: string, children: Channel['children'] = []): Channel {
  return { id, name, emoji: '💰', amount: 0, color: '#000', isParent: true, isExpanded: false, children };
}

describe('京东金融 Migration（v1.4 → v1.5，幂等）', () => {
  it('v1.4 数据无京东金融 → 新增父渠道 + 默认子渠道', () => {
    const before = [channel('alipay', '支付宝', [])];
    const { channels, addedParent, addedChildren } = migrateChannelsV15(before);
    expect(addedParent).toBe(1);
    expect(addedChildren).toBe(JD_FINANCE_CHILDREN.length);
    const jd = channels.find((c) => c.id === 'jd_finance');
    expect(jd?.name).toBe('京东金融');
    expect(jd?.children).toHaveLength(JD_FINANCE_CHILDREN.length);
  });

  it('已有京东金融 → 不重复创建父渠道', () => {
    const before = [channel('jd_finance', '京东金融', [])];
    const { channels, addedParent } = migrateChannelsV15(before);
    expect(addedParent).toBe(0);
    expect(channels.filter((c) => c.id === 'jd_finance')).toHaveLength(1);
  });

  it('用户手工创建「京东金融」（不同 id）→ 通过规范化名称识别，不重复', () => {
    const before = [channel('custom_jd', '京东金融', [])];
    const { channels, addedParent } = migrateChannelsV15(before);
    expect(addedParent).toBe(0);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.id).toBe('custom_jd');
  });

  it('已有基金子渠道 → 不重复基金，且金额保持', () => {
    const jd = channel('jd_finance', '京东金融', [
      { id: 'user_fund', name: '基金', emoji: '📊', amount: 123, color: '#ff0000', parentId: 'jd_finance' },
    ]);
    const { channels } = migrateChannelsV15([jd]);
    const funds = channels[0]!.children!.filter((c) => c.name === '基金');
    expect(funds).toHaveLength(1);
    expect(funds[0]!.amount).toBe(123);
    expect(funds[0]!.id).toBe('user_fund'); // 保留用户子渠道
  });

  it('Migration 再执行一次 → 完全相同（幂等）', () => {
    const once = migrateChannelsV15([channel('alipay', '支付宝', [])]);
    const twice = migrateChannelsV15(once.channels);
    expect(twice.addedParent).toBe(0);
    expect(twice.addedChildren).toBe(0);
    expect(twice.channels).toEqual(once.channels);
  });

  it('新安装 defaultChannels 包含京东金融且不含真实银行卡尾号', () => {
    const channels = defaultChannels();
    expect(channels.some((c) => c.id === 'jd_finance')).toBe(true);
    // 不包含真实银行卡尾号
    const allNames = JSON.stringify(channels);
    expect(allNames).not.toContain('3066');
    expect(allNames).not.toContain('浦发');
  });
});
