import { describe, expect, it } from 'vitest';
import { confirmHistoryEdit, prepareHistoryEdit } from '../../src/features/history/transaction';
import type { HistoryPoint } from '../../src/types';

const source: HistoryPoint = {
  date: '2026-10-11', totalAmount: 100, source: 'live-snapshot', eventNote: '搬家',
  channels: [{ id: 'cash', name: '现金', emoji: '💵', amount: 100, color: '#000', isParent: true, isExpanded: false }],
};
const now = '2026-10-13T08:00:00.000Z';

describe('atomic history edits', () => {
  it('prepares without writes and moves a date in one replacement, preserving notes and unchanged composition', () => {
    const state = { baseRevision: 7, history: [source] };
    const proposal = prepareHistoryEdit(state, { sourceDate: source.date, date: '2026-10-12', totalAmount: 100 }, now);
    expect(state.history).toEqual([source]);
    const result = confirmHistoryEdit(state, proposal);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ date: '2026-10-12', totalAmount: 100, channels: source.channels, eventNote: '搬家' });
  });

  it('requires overwrite approval and removes the source even when the target is occupied', () => {
    const occupied = { date: '2026-10-12', totalAmount: 200, eventNote: '目标记录' };
    const state = { baseRevision: 2, history: [source, occupied] };
    const proposal = prepareHistoryEdit(state, { sourceDate: source.date, date: occupied.date, totalAmount: 125 }, now);
    expect(() => confirmHistoryEdit(state, proposal)).toThrow('明确确认覆盖');
    expect(confirmHistoryEdit(state, proposal, true).history).toEqual([expect.objectContaining({ date: occupied.date, totalAmount: 125, eventNote: '搬家' })]);
    expect(proposal.clearsComposition).toBe(true);
    expect(proposal.after.channels).toBeUndefined();
  });

  it('retains unknown fields and clears composition when the aggregate amount changes', () => {
    const state = { baseRevision: 3, history: [{ ...source, futureMetadata: { origin: 'legacy' } }] };
    const proposal = prepareHistoryEdit(state, { sourceDate: source.date, date: source.date, totalAmount: 100.125 }, now);
    const result = confirmHistoryEdit(state, proposal);
    expect(result.history[0]).toMatchObject({ totalAmount: 100.13, futureMetadata: { origin: 'legacy' }, eventNote: '搬家' });
    expect(result.history[0]?.channels).toBeUndefined();
  });

  it('does not write for an unchanged edit', () => {
    const state = { baseRevision: 1, history: [source] };
    const proposal = prepareHistoryEdit(state, { sourceDate: source.date, date: source.date, totalAmount: 100 }, now);
    expect(confirmHistoryEdit(state, proposal)).toEqual({ changed: false, history: [source] });
  });

  it('rejects stale, altered and deserialized previews', () => {
    const state = { baseRevision: 1, history: [source] };
    const proposal = prepareHistoryEdit(state, { sourceDate: source.date, date: source.date, totalAmount: 101 }, now);
    expect(() => confirmHistoryEdit({ ...state, baseRevision: 2 }, proposal)).toThrow('数据已变化');
    expect(() => confirmHistoryEdit({ ...state, history: [] }, proposal)).toThrow('数据已变化');
    expect(() => confirmHistoryEdit(state, JSON.parse(JSON.stringify(proposal)))).toThrow('不是本次准备');
    proposal.after.totalAmount = 999;
    expect(() => confirmHistoryEdit(state, proposal)).toThrow('预览已变化');
  });

  it.each([
    { date: '2026-02-30', totalAmount: 100 },
    { date: '2026-10-12', totalAmount: NaN },
    { date: '2026-10-12', totalAmount: Infinity },
  ])('rejects invalid commands before preparing: %j', command => {
    expect(() => prepareHistoryEdit({ baseRevision: 1, history: [] }, command, now)).toThrow();
  });

  it('refuses duplicate dates in the ledger', () => {
    expect(() => prepareHistoryEdit({ baseRevision: 1, history: [source, source] }, { date: '2026-10-12', totalAmount: 100 }, now)).toThrow('重复');
  });
});
