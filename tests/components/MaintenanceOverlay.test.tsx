import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../../src/components/ui/Modal';
import { MaintenanceOverlay } from '../../src/features/workspace/MaintenanceOverlay';

afterEach(cleanup);

describe('MaintenanceOverlay', () => {
  it('keeps an open dialog mounted while blocking keyboard dismissal and restoring focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Surface({ busy }: { busy: boolean }) {
      return <><Modal open onClose={onClose} title="恢复确认"><button>确认恢复</button></Modal>{busy && <MaintenanceOverlay label="正在恢复，请等待" />}</>;
    }
    const { rerender } = render(<Surface busy={false} />);
    const dialog = screen.getByRole('dialog', { name: '恢复确认' });
    await waitFor(() => expect(dialog).toHaveFocus());
    const confirm = screen.getByRole('button', { name: '确认恢复' });
    confirm.focus();

    rerender(<Surface busy />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('正在恢复，请等待');
    expect(status).toHaveFocus();
    expect(dialog).toBeInTheDocument();
    expect(dialog.parentElement).toHaveAttribute('inert');
    await user.keyboard('{Escape}{Tab}{Enter}');
    expect(onClose).not.toHaveBeenCalled();
    expect(status).toHaveFocus();

    rerender(<Surface busy={false} />);
    expect(dialog.parentElement).not.toHaveAttribute('inert');
    expect(confirm).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('also blocks newly mounted body portals and restores their previous inert state', async () => {
    const { unmount } = render(<MaintenanceOverlay label="正在备份，请等待" />);
    const latePortal = document.createElement('div');
    const previouslyInert = document.createElement('div');
    previouslyInert.setAttribute('inert', 'existing');
    document.body.append(latePortal, previouslyInert);
    await waitFor(() => expect(latePortal).toHaveAttribute('inert'));
    unmount();
    expect(latePortal).not.toHaveAttribute('inert');
    expect(previouslyInert).toHaveAttribute('inert', 'existing');
    latePortal.remove();
    previouslyInert.remove();
  });
});
