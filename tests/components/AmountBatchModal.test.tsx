import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import type { Channel } from '../../src/types';
import { AmountBatchModal } from '../../src/features/assets/AmountBatchModal';
import { prepareAmountBatch } from '../../src/features/assets/amountBatch';

const channels: Channel[] = [
  { id: 'cash', name: '现金', emoji: '💵', amount: 100, color: '#22c55e', isParent: true, isExpanded: false },
];
const history = [{ date: '2026-10-13', totalAmount: 100, source: 'manual' as const }];

afterEach(() => {
  act(() => useWorkspaceStore.setState({ amountsHidden: false }));
});

describe('AmountBatchModal', () => {
  it('keeps candidates local until preview and confirmation, and cancel does not commit', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onPrepare = vi.fn((changes) => prepareAmountBatch({ channels, history, baseRevision: 1 }, changes, '2026-10-13', '2026-10-13T03:00:00.000Z'));
    const { unmount } = render(<AmountBatchModal channels={channels} onClose={onClose} onPrepare={onPrepare} onConfirm={onConfirm} />);

    const amountInput = screen.getByRole('textbox', { name: '现金金额' });
    expect(amountInput).toHaveValue('');
    fireEvent.change(amountInput, { target: { value: '123.45' } });
    expect(onPrepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(history[0]?.totalAmount).toBe(100);
    unmount();
  });

  it('previews parsed changes and confirms only the displayed proposal', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onPrepare = vi.fn((changes) => prepareAmountBatch({ channels, history, baseRevision: 1 }, changes, '2026-10-13', '2026-10-13T03:00:00.000Z'));
    render(<AmountBatchModal channels={channels} onClose={onClose} onPrepare={onPrepare} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByRole('textbox', { name: '现金金额' }), { target: { value: '1,234.50' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(onPrepare).toHaveBeenCalledWith([{ parentId: 'cash', childId: undefined, amount: 1234.5 }]);
    expect(screen.getByText('现金')).toBeInTheDocument();
    expect(screen.getAllByText(/1,234\.50/)).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('masks current and proposed amounts and clears a draft when privacy turns on', () => {
    useWorkspaceStore.setState({ amountsHidden: false });
    const onPrepare = vi.fn((changes) => prepareAmountBatch({ channels, history, baseRevision: 1 }, changes, '2026-10-13', '2026-10-13T03:00:00.000Z'));
    render(<AmountBatchModal channels={channels} onClose={vi.fn()} onPrepare={onPrepare} onConfirm={vi.fn()} />);

    expect(screen.getByLabelText('现金当前金额')).toHaveTextContent('¥100.00');
    fireEvent.change(screen.getByRole('textbox', { name: '现金金额' }), { target: { value: '999.00' } });
    expect(screen.getByRole('textbox', { name: '现金金额' })).toHaveValue('999.00');
    act(() => useWorkspaceStore.setState({ amountsHidden: true }));
    expect(screen.getByRole('textbox', { name: '现金金额' })).toHaveValue('');
    expect(screen.getByLabelText('现金当前金额')).toHaveTextContent('¥••••');

    fireEvent.change(screen.getByRole('textbox', { name: '现金金额' }), { target: { value: '999.00' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(screen.queryByText(/100\.00|999\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByText('¥••••').length).toBeGreaterThan(0);
  });
});
