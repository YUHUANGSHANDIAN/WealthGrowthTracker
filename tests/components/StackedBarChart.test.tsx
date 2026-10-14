import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StackedBarChart } from '../../src/components/charts/StackedBarChart';

describe('signed calendar composition chart', () => {
  it('renders signed values without negative SVG heights and exposes missing rows', () => {
    const { container } = render(<StackedBarChart data={[
      { date: '2026-01-01', segments: [{ id: 'a', name: '资产', color: '#000', value: 100 }, { id: 'b', name: '差额', color: '#111', value: -50 }] },
      { date: '2026-01-02', missing: true, segments: [] },
    ]} />);
    for (const rect of container.querySelectorAll('rect')) expect(Number(rect.getAttribute('height'))).toBeGreaterThanOrEqual(0);
    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByText('缺少快照或无法计算占比')).toBeInTheDocument();
    expect(screen.getByText('查看构成数据表')).toBeInTheDocument();
  });
  it('positions bars by actual calendar distances', () => {
    const { container } = render(<StackedBarChart data={['2026-01-01', '2026-01-02', '2026-01-11'].map(date => ({ date, segments: [{ name: '资产', color: '#000', value: 100 }] }))} />);
    const positions = [...container.querySelectorAll('rect')].map(rect => Number(rect.getAttribute('x')));
    expect((positions[2]! - positions[1]!) / (positions[1]! - positions[0]!)).toBeCloseTo(9);
  });
});
