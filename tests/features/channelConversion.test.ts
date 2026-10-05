import { describe, it, expect } from 'vitest';
import type { Channel, SubChannel } from '../../src/types';
import {
  promoteParentToChildren,
  collapseParentToDirectAmount,
  totalAssets,
  makeSubChannel,
} from '../../src/utils/channels';

function parent(id: string, amount = 0, children: SubChannel[] = []): Channel {
  return { id, name: id, emoji: '💰', amount, color: '#000', isParent: true, isExpanded: false, children };
}

function sub(parentId: string, amount = 0): SubChannel {
  return { id: `s_${parentId}`, name: '子渠道', emoji: '💰', amount, color: '#000', parentId };
}

describe('父渠道 ⇄ 子渠道 结构转换（资产守恒）', () => {
  it('新父渠道（金额 0）可以直接添加首个子渠道', () => {
    const result = promoteParentToChildren([parent('a', 0)], 'a', sub('a', 0), 'direct');
    expect(result.channels[0]!.children).toHaveLength(1);
    expect(result.addedChildren).toHaveLength(1);
    expect(result.lostAmount).toBe(0);
    expect(totalAssets(result.channels)).toBe(0);
  });

  it('父金额 100 → 首子（transfer）：金额转入子渠道，资产守恒', () => {
    const result = promoteParentToChildren([parent('a', 100)], 'a', sub('a', 0), 'transfer');
    expect(result.channels[0]!.children).toHaveLength(1);
    expect(result.channels[0]!.children![0]!.amount).toBe(100);
    expect(totalAssets(result.channels)).toBe(100);
    expect(result.lostAmount).toBe(0);
  });

  it('父金额 100 → 未分类 + 新子（uncategorized）：资产守恒', () => {
    const result = promoteParentToChildren([parent('a', 100)], 'a', sub('a', 0), 'uncategorized');
    expect(result.channels[0]!.children).toHaveLength(2);
    const uncat = result.channels[0]!.children!.find((c) => c.name === '未分类');
    expect(uncat?.amount).toBe(100);
    expect(totalAssets(result.channels)).toBe(100);
    expect(result.lostAmount).toBe(0);
  });

  it('父金额 100 → clear：清空直接金额，总资产减少 100', () => {
    const result = promoteParentToChildren([parent('a', 100)], 'a', sub('a', 0), 'clear');
    expect(totalAssets(result.channels)).toBe(0);
    expect(result.lostAmount).toBe(100);
  });

  it('已有子渠道的父渠道，再添加子渠道不改变金额', () => {
    const withChild = parent('a', 0, [sub('a', 50)]);
    const result = promoteParentToChildren([withChild], 'a', sub('a', 0), 'transfer');
    expect(result.channels[0]!.children).toHaveLength(2);
    expect(totalAssets(result.channels)).toBe(50);
  });

  it('删除最后一个子渠道（keep-direct）：父渠道变为直接持有该金额', () => {
    const result = collapseParentToDirectAmount([parent('a', 0, [sub('a', 100)])], 'a', 's_a', 'keep-direct');
    expect(result.channels[0]!.children).toHaveLength(0);
    expect(result.channels[0]!.amount).toBe(100);
    expect(totalAssets(result.channels)).toBe(100);
    expect(result.lostAmount).toBe(0);
  });

  it('删除最后一个子渠道（drop-amount）：总资产减少', () => {
    const result = collapseParentToDirectAmount([parent('a', 0, [sub('a', 100)])], 'a', 's_a', 'drop-amount');
    expect(result.channels[0]!.children).toHaveLength(0);
    expect(result.channels[0]!.amount).toBe(0);
    expect(totalAssets(result.channels)).toBe(0);
    expect(result.lostAmount).toBe(100);
  });

  it('删除非最后一个子渠道：剩余子渠道汇总，资产守恒', () => {
    const c1 = { ...sub('a', 30), id: 'c1' };
    const c2 = { ...sub('a', 70), id: 'c2' };
    const result = collapseParentToDirectAmount([parent('a', 0, [c1, c2])], 'a', 'c1', 'drop-amount');
    expect(result.channels[0]!.children).toHaveLength(1);
    expect(totalAssets(result.channels)).toBe(70);
    expect(result.lostAmount).toBe(0);
  });

  it('makeSubChannel 默认金额为 0（不意外写入金额）', () => {
    const s = makeSubChannel('a', '余额', '💰', '#000');
    expect(s.amount).toBe(0);
    expect(s.parentId).toBe('a');
  });
});
