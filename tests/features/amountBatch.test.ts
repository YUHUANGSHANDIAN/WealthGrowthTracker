import { describe, expect, it } from 'vitest';
import type { Channel, HistoryPoint } from '../../src/types';
import { confirmAmountBatch, prepareAmountBatch } from '../../src/features/assets/amountBatch';

const channels: Channel[] = [
  {
    id: 'cash', name: '现金', emoji: '💵', amount: 100, color: '#22c55e', isParent: true, isExpanded: false,
  },
  {
    id: 'bank', name: '银行', emoji: '🏦', amount: 300, color: '#3b82f6', isParent: true, isExpanded: false,
    children: [
      { id: 'checking', parentId: 'bank', name: '活期', emoji: '💳', amount: 100, color: '#3b82f6' },
      { id: 'savings', parentId: 'bank', name: '定期', emoji: '🔒', amount: 200, color: '#3b82f6' },
    ],
  },
];

const history: HistoryPoint[] = [
  { date: '2026-10-12', totalAmount: 390, source: 'manual' },
  { date: '2026-10-13', totalAmount: 400, source: 'manual', name: '保留的用户说明' },
];

const state = () => ({ channels, history, baseRevision: 7 });
const nowIso = '2026-10-13T02:00:00.000Z';

describe('amount batch transaction', () => {
  it('prepares without mutating live state, then confirms one complete same-day snapshot', () => {
    const initial = state();
    const proposal = prepareAmountBatch(initial, [
      { parentId: 'cash', amount: 125.555 },
      { parentId: 'bank', childId: 'savings', amount: 250 },
    ], '2026-10-13', nowIso);

    expect(initial.channels[0]?.amount).toBe(100);
    expect(initial.history[1]?.totalAmount).toBe(400);
    expect(proposal.channels[0]?.amount).toBe(125.56);
    expect(proposal.channels[1]?.amount).toBe(350);
    expect(proposal.newTotal).toBe(475.56);
    expect(proposal.changes.map((change) => change.path)).toEqual(['现金', '银行 / 定期']);
    expect(proposal.history.filter((point) => point.date === '2026-10-13')).toHaveLength(1);
    expect(proposal.history[1]).toMatchObject({
      totalAmount: 475.56,
      source: 'live-snapshot',
      name: '保留的用户说明',
      updatedAt: nowIso,
    });
    expect(proposal.history[1]?.channels?.[1]?.amount).toBe(350);

    const result = confirmAmountBatch(initial, proposal);
    expect(result.changed).toBe(true);
    expect(result.channels).toEqual(proposal.channels);
    expect(result.history).toEqual(proposal.history);
  });

  it('keeps a no-op proposal free of history writes', () => {
    const initial = state();
    const proposal = prepareAmountBatch(initial, [{ parentId: 'cash', amount: 100 }], '2026-10-13', nowIso);
    expect(proposal.changed).toBe(false);
    expect(proposal.history).toEqual(history);
    expect(confirmAmountBatch(initial, proposal).history).toEqual(history);
  });

  it('rejects duplicate or invalid targets and edits to a parent rollup', () => {
    expect(() => prepareAmountBatch(state(), [
      { parentId: 'cash', amount: 1 }, { parentId: 'cash', amount: 2 },
    ], '2026-10-13', nowIso)).toThrow('同一渠道不能重复提交');
    expect(() => prepareAmountBatch(state(), [{ parentId: 'missing', amount: 1 }], '2026-10-13', nowIso)).toThrow('渠道不存在');
    expect(() => prepareAmountBatch(state(), [{ parentId: 'bank', amount: 1 }], '2026-10-13', nowIso)).toThrow('父渠道金额');
    expect(() => prepareAmountBatch(state(), [{ parentId: 'cash', amount: -1 }], '2026-10-13', nowIso)).toThrow('非负');
    expect(() => prepareAmountBatch(state(), [{ parentId: 'bank', childId: 'missing', amount: 1 }], '2026-10-13', nowIso)).toThrow('子渠道不存在');
  });

  it('rejects duplicate history dates before preparing a transaction', () => {
    const initial = { ...state(), history: [...history, { date: '2026-10-13', totalAmount: 999 }] };
    expect(() => prepareAmountBatch(initial, [{ parentId: 'cash', amount: 5 }], '2026-10-13', nowIso)).toThrow('历史日期无效或重复');
  });

  it('rejects stale or altered proposals', () => {
    const initial = state();
    const proposal = prepareAmountBatch(initial, [{ parentId: 'cash', amount: 120 }], '2026-10-13', nowIso);
    expect(() => confirmAmountBatch({ ...initial, baseRevision: 8 }, proposal)).toThrow('数据已变化');
    expect(() => confirmAmountBatch({ ...initial, channels: [{ ...channels[0]!, amount: 101 }, channels[1]!] }, proposal)).toThrow('数据已变化');
    expect(() => confirmAmountBatch(initial, { ...proposal, newTotal: 999 })).toThrow('预览已变化');
  });
});
