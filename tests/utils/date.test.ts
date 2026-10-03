import { describe, it, expect } from 'vitest';
import {
  weekStart,
  weekEnd,
  monthStart,
  monthEnd,
  yearStart,
  yearEnd,
  daysBetween,
  addDays,
  weekNumberOfYear,
  todayString,
  toDateString,
} from '../../src/utils/date';

describe('date 工具', () => {
  it('weekStart 以周一为一周开始', () => {
    // 2026-10-03 是周六
    expect(weekStart('2026-10-03')).toBe('2026-09-28');
    expect(weekEnd('2026-10-03')).toBe('2026-10-04');
  });

  it('monthStart / monthEnd', () => {
    expect(monthStart('2026-10-15')).toBe('2026-10-01');
    expect(monthEnd('2026-10-15')).toBe('2026-10-31');
    expect(monthEnd('2026-02-15')).toBe('2026-02-28');
  });

  it('yearStart / yearEnd', () => {
    expect(yearStart('2026-07-01')).toBe('2026-01-01');
    expect(yearEnd('2026-07-01')).toBe('2026-12-31');
  });

  it('daysBetween 与 addDays', () => {
    expect(daysBetween('2026-01-01', '2026-01-11')).toBe(10);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('weekNumberOfYear 稳定计算', () => {
    const n = weekNumberOfYear('2026-10-03');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(53);
  });

  it('todayString 返回合法 YYYY-MM-DD', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
