import { describe, it, expect } from 'vitest';
import { migrateChannelsV12, needsV12Migration, CAMPUS_SCHOOLS } from '../../src/services/migration';
import type { Channel } from '../../src/types';

function campus(children: Channel['children'] = []): Channel {
  return { id: 'campus_card', name: '校园卡', emoji: '🎓', amount: 0, color: '#06B6D4', isParent: true, isExpanded: false, children };
}

describe('校园卡 v1.2 迁移', () => {
  it('空校园卡 → 添加三所学校', () => {
    const { channels, added } = migrateChannelsV12([campus([])]);
    expect(added).toBe(3);
    expect(channels[0]!.children).toHaveLength(3);
    expect(channels[0]!.children!.map((c) => c.name)).toEqual(['大连理工大学', '天津大学', '复旦大学']);
  });

  it('已有部分学校 → 只补缺失', () => {
    const existing = [{ id: 'campus_card_dlut', name: '大连理工大学', emoji: '🎓', amount: 0, color: '#06B6D4', parentId: 'campus_card' }];
    const { channels, added } = migrateChannelsV12([campus(existing)]);
    expect(added).toBe(2);
    expect(channels[0]!.children).toHaveLength(3);
  });

  it('用户删除校园卡 → 不重建', () => {
    const { channels, added } = migrateChannelsV12([{ id: 'alipay', name: '支付宝', emoji: '💙', amount: 0, color: '#3B82F6', isParent: true, isExpanded: false, children: [] }]);
    expect(added).toBe(0);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.id).toBe('alipay');
  });

  it('幂等：重复运行不产生重复项', () => {
    const first = migrateChannelsV12([campus([])]);
    const second = migrateChannelsV12(first.channels);
    expect(second.added).toBe(0);
    expect(second.channels[0]!.children).toHaveLength(3);
  });

  it('CAMPUS_SCHOOLS 稳定 ID', () => {
    expect(CAMPUS_SCHOOLS.map((s) => s.id)).toEqual(['campus_card_dlut', 'campus_card_tju', 'campus_card_fudan']);
  });

  it('needsV12Migration 版本比较', () => {
    expect(needsV12Migration('1.1.0')).toBe(true);
    expect(needsV12Migration('1.0.0')).toBe(true);
    expect(needsV12Migration('1.2.0')).toBe(false);
    expect(needsV12Migration('1.3.0')).toBe(false);
    expect(needsV12Migration(null)).toBe(true);
  });
});
