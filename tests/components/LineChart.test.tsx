import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LineChart } from '../../src/components/charts/LineChart';

afterEach(cleanup);
describe('LineChart gaps and accessible data', () => {
  it('does not join segments across a missing value', () => {
    const { container } = render(<LineChart series={[{id:'total',name:'总资产',color:'#123456',area:true,points:[
      {date:'2026-01-01',value:10},{date:'2026-01-02',value:null},{date:'2026-01-03',value:30},
    ]}]} />);
    const paths = [...container.querySelectorAll('path[stroke="#123456"]')];
    expect(paths).toHaveLength(2);
    expect(paths.every(path=>!path.getAttribute('d')?.includes('L'))).toBe(true);
    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByRole('cell',{name:'未知'})).toBeInTheDocument();
  });
  it('lets keyboard users select dates and announces unknown values', () => {
    render(<LineChart series={[{id:'total',name:'资产',color:'#123456',points:[
      {date:'2026-01-01',value:10},{date:'2026-01-02',value:null},
    ]}]} />);
    const chart=screen.getByRole('img');
    fireEvent.keyDown(chart,{key:'Home'});
    expect(screen.getByRole('status')).toHaveTextContent('2026-01-01');
    fireEvent.keyDown(chart,{key:'ArrowRight'});
    expect(screen.getByRole('status')).toHaveTextContent('2026-01-02');
    expect(screen.getByRole('status')).toHaveTextContent('—');
  });
});
