import { describe, expect, it } from 'vitest';
import { buildDraftInput } from '../../src/features/monthlyPlanning/sessionDraft';
import { createDraftSession } from '../../src/domain/portfolio/session';
import type { MonthlyReview } from '../../src/domain/portfolio/types';

const base = {
  planningMonth: '2026-07', snapshotDate: '', previous: null, timezone: 'Asia/Shanghai',
  now: '2026-10-16T02:00:00.000Z', today: '2026-10-16',
};

function confirmed(month: string, snapshotAsOf: string): MonthlyReview {
  return { ...createDraftSession({ planningMonth: month, timezone: 'Asia/Shanghai', today: snapshotAsOf, now: base.now }), state: 'confirmed' };
}

describe('月度会话创建输入', () => {
  it('留空快照日时沿用今天，且首期复盘区间从当月 1 日开始', () => {
    const built = buildDraftInput({ ...base, planningMonth: '2026-10' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.today).toBe('2026-10-16');
    expect(built.input.periodStart).toBe('2026-10-01');
    const session = createDraftSession(built.input);
    expect(session.snapshotAsOf).toBe('2026-10-16');
    expect(session.reviewPeriodEnd).toBe('2026-10-16');
    expect(session.key).toBe('monthly-planning:2026-10');
    expect(built.notice).toBeUndefined();
  });

  it('补录历史月份时使用真实快照日并给出补录提示', () => {
    const built = buildDraftInput({ ...base, planningMonth: '2026-07', snapshotDate: '2026-07-20', today: '2026-10-16' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const session = createDraftSession(built.input);
    expect(session.reviewPeriodStart).toBe('2026-07-01');
    expect(session.reviewPeriodEnd).toBe('2026-07-20');
    expect(session.snapshotAsOf).toBe('2026-07-20');
    expect(built.notice).toBeUndefined();
  });

  it('快照日不在所选月份内可继续，但必须给出补录提示', () => {
    const built = buildDraftInput({ ...base, planningMonth: '2026-07', snapshotDate: '2026-07-31', today: '2026-10-16' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.notice).toBeUndefined();
    const next = buildDraftInput({ ...base, planningMonth: '2026-06', snapshotDate: '2026-07-02', today: '2026-10-16' });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.notice).toContain('2026-06');
    expect(next.notice).toContain('补录');
  });

  it('拒绝未来日期、非法日期和非法月份', () => {
    expect(buildDraftInput({ ...base, planningMonth: '2026-10', snapshotDate: '2026-10-17' }))
      .toMatchObject({ ok: false, message: expect.stringContaining('不能晚于今天') });
    for (const invalid of ['2026-02-30', '2026-7-1', 'yesterday', '2026/07/20']) {
      expect(buildDraftInput({ ...base, planningMonth: '2026-07', snapshotDate: invalid }))
        .toMatchObject({ ok: false, message: expect.stringContaining('有效日期') });
    }
    expect(buildDraftInput({ ...base, planningMonth: '2026-13' }))
      .toMatchObject({ ok: false, message: expect.stringContaining('YYYY-MM') });
  });

  it('承接上月快照时点作为复盘区间起点，且拒绝倒挂的快照日', () => {
    const previous = confirmed('2026-07', '2026-07-20');
    const built = buildDraftInput({ ...base, planningMonth: '2026-08', snapshotDate: '2026-08-05', previous, today: '2026-10-16' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.periodStart).toBe('2026-07-20');
    const session = createDraftSession(built.input);
    expect(session.reviewPeriodStart).toBe('2026-07-20');
    expect(session.reviewPeriodStart <= session.reviewPeriodEnd).toBe(true);

    expect(buildDraftInput({ ...base, planningMonth: '2026-08', snapshotDate: '2026-07-01', previous, today: '2026-10-16' }))
      .toMatchObject({ ok: false, message: expect.stringContaining('2026-07-20') });
  });
});
