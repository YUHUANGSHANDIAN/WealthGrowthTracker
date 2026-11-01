import { describe, it, expect } from 'vitest';
import { checkDataHealth, applyHealthFixes } from '../../src/utils/dataHealth';
import { mergeData, previewMerge } from '../../src/utils/mergeData';
import type { Channel, HistoryPoint } from '../../src/types';

describe('数据健康检查', () => {
  it('健康数据返回 ok', () => {
    const channels: Channel[] = [{ id: 'a', name: 'A', emoji: '💰', amount: 10, color: '#000', isParent: true, isExpanded: false, children: [] }];
    const history: HistoryPoint[] = [{ date: '2026-01-01', totalAmount: 10 }];
    expect(checkDataHealth(channels, history).ok).toBe(true);
  });

  it('检测非法金额并可修复', () => {
    const channels: Channel[] = [{ id: 'a', name: 'A', emoji: '💰', amount: NaN, color: '#000', isParent: true, isExpanded: false, children: [] }];
    const history: HistoryPoint[] = [{ date: '2026-01-01', totalAmount: Infinity }];
    const { issues } = checkDataHealth(channels, history);
    expect(issues.some((i) => i.fix === 'sanitize-amounts')).toBe(true);
    const fixed = applyHealthFixes(channels, history, issues);
    expect(Number.isFinite(fixed.channels[0]!.amount)).toBe(true);
    expect(Number.isFinite(fixed.history[0]!.totalAmount)).toBe(true);
  });

  it('检测重复历史日期并可去重', () => {
    const history: HistoryPoint[] = [
      { date: '2026-01-01', totalAmount: 10 },
      { date: '2026-01-01', totalAmount: 20 },
    ];
    const { issues } = checkDataHealth([], history);
    expect(issues.some((i) => i.fix === 'dedupe-history')).toBe(true);
    const fixed = applyHealthFixes([], history, issues);
    expect(fixed.history).toHaveLength(1);
    expect(fixed.history[0]!.totalAmount).toBe(20); // 保留最后一条
  });

  it('单项修复不会顺带改写其他可修复问题', () => {
    const channels: Channel[] = [{ id: 'a', name: 'A', emoji: '💰', amount: NaN, color: '#000', isParent: true, isExpanded: false, children: [] }];
    const history: HistoryPoint[] = [
      { date: '2026-01-01', totalAmount: 10 },
      { date: '2026-01-01', totalAmount: 20 },
    ];
    const issues = checkDataHealth(channels, history).issues;
    const duplicateOnly = issues.filter((issue) => issue.fix === 'dedupe-history');
    const fixed = applyHealthFixes(channels, history, duplicateOnly);
    expect(Number.isNaN(fixed.channels[0]!.amount)).toBe(true);
    expect(fixed.history).toEqual([{ date: '2026-01-01', totalAmount: 20 }]);
  });
});

describe('数据合并', () => {
  it('previewMerge 统计新增与冲突', () => {
    const current = {
      channels: [{ id: 'a', name: 'A', emoji: '💰', amount: 1, color: '#000', isParent: true, isExpanded: false, children: [] }],
      history: [{ date: '2026-01-01', totalAmount: 1 }],
      reports: [],
    };
    const incoming = {
      channels: [
        { id: 'a', name: 'A', emoji: '💰', amount: 999, color: '#000', isParent: true, isExpanded: false, children: [] }, // 冲突
        { id: 'b', name: 'B', emoji: '💰', amount: 2, color: '#000', isParent: true, isExpanded: false, children: [] }, // 新增
      ],
      history: [{ date: '2026-01-01', totalAmount: 999 }, { date: '2026-01-02', totalAmount: 2 }],
      reports: [],
    };
    const p = previewMerge(current, incoming);
    expect(p.channels.added).toBe(1);
    expect(p.channels.conflict).toBe(1);
    expect(p.history.added).toBe(1);
    expect(p.history.conflict).toBe(1);
  });

  it('mergeData 冲突保留当前', () => {
    const current = { channels: [{ id: 'a', name: 'A', emoji: '💰', amount: 1, color: '#000', isParent: true, isExpanded: false, children: [] }], history: [{ date: '2026-01-01', totalAmount: 1 }], reports: [] };
    const incoming = { channels: [{ id: 'a', name: 'A', emoji: '💰', amount: 999, color: '#000', isParent: true, isExpanded: false, children: [] }, { id: 'b', name: 'B', emoji: '💰', amount: 2, color: '#000', isParent: true, isExpanded: false, children: [] }], history: [], reports: [] };
    const merged = mergeData(current, incoming);
    expect(merged.channels).toHaveLength(2);
    expect(merged.channels.find((c) => c.id === 'a')!.amount).toBe(1); // 保留当前
  });
});
