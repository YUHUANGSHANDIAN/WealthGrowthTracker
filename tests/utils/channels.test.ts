import { describe, it, expect } from 'vitest';
import type { Channel, CustomSortRule } from '../../src/types';
import {
  channelAmount,
  totalAssets,
  leafChannels,
  addChildChannel,
  removeChildChannel,
  updateChildAmount,
  setLeafAmount,
  makeSubChannel,
  sortChannelsByRule,
} from '../../src/utils/channels';

function parent(id: string, children: Channel['children'] = []): Channel {
  return { id, name: id, emoji: '💰', amount: 0, color: '#000', isParent: true, isExpanded: false, children };
}

describe('channels 工具', () => {
  it('totalAssets 计算父渠道（子渠道求和）+ 无子渠道父渠道', () => {
    const channels = [
      parent('a', [
        { id: 'a1', name: 'x', emoji: '💰', amount: 10, color: '#000', parentId: 'a' },
        { id: 'a2', name: 'y', emoji: '💰', amount: 20.5, color: '#000', parentId: 'a' },
      ]),
      parent('b', []),
    ];
    // b 无子渠道，amount 直接记 100
    channels[1]!.amount = 100;
    expect(totalAssets(channels)).toBe(130.5);
  });

  it('channelAmount 父渠道金额 = 子渠道之和', () => {
    const c = parent('a', [
      { id: 'a1', name: 'x', emoji: '💰', amount: 1.1, color: '#000', parentId: 'a' },
      { id: 'a2', name: 'y', emoji: '💰', amount: 2.2, color: '#000', parentId: 'a' },
    ]);
    expect(channelAmount(c)).toBe(3.3);
  });

  it('addChildChannel / removeChildChannel / updateChildAmount', () => {
    let channels = [parent('a')];
    const sub = makeSubChannel('a', '余额', '💰', '#000');
    channels = addChildChannel(channels, 'a', sub);
    expect(channels[0]!.children).toHaveLength(1);

    channels = updateChildAmount(channels, 'a', sub.id, 50);
    expect(channels[0]!.children![0]!.amount).toBe(50);
    expect(channels[0]!.amount).toBe(50);

    channels = removeChildChannel(channels, 'a', sub.id);
    expect(channels[0]!.children).toHaveLength(0);
  });

  it('setLeafAmount 无子渠道父渠道直接设置金额', () => {
    let channels = [parent('b')];
    channels = setLeafAmount(channels, { parentId: 'b' }, 200);
    expect(channels[0]!.amount).toBe(200);
  });

  it('leafChannels 区分子渠道与父渠道直接金额', () => {
    const channels = [
      parent('a', [{ id: 'a1', name: 'x', emoji: '💰', amount: 1, color: '#000', parentId: 'a' }]),
      parent('b'),
    ];
    channels[1]!.amount = 5;
    const leaves = leafChannels(channels);
    expect(leaves).toHaveLength(2);
    expect(leaves.find((l) => l.id === 'a1')?.parentName).toBe('a');
    expect(leaves.find((l) => l.id === 'a1')?.kind).toBe('subchannel');
    expect(leaves.find((l) => l.id === 'b')?.kind).toBe('parent-direct');
  });

  it('sortChannelsByRule 按金额降序', () => {
    const a = parent('a'); a.amount = 10;
    const b = parent('b'); b.amount = 50;
    const c = parent('c'); c.amount = 30;
    const rule: CustomSortRule = { id: 'r', key: 'amount-desc', label: '', field: 'amount', direction: 'desc', category: '', tags: [] };
    const sorted = sortChannelsByRule([a, b, c], rule, { totalAmount: 90 });
    expect(sorted.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});
