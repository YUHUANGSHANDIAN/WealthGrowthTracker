import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../../src/features/workspace/CommandPalette';
import { useNavigationStore } from '../../src/store/navigationStore';

beforeEach(() => useNavigationStore.getState().navigate({ tab: 'overview' }));
afterEach(() => {
  cleanup();
  useNavigationStore.getState().navigate({ tab: 'overview' });
});

describe('local settings search', () => {
  it('matches an appearance keyword and opens the linked category', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('搜索本地内容'), { target: { value: '深色' } });
    fireEvent.click(screen.getByRole('button', { name: /设置 · 外观偏好/ }));
    expect(useNavigationStore.getState().settingsSection).toBe('appearance');
    expect(window.location.hash).toBe('#/settings?section=appearance');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opens a security category using Enter and a PIN keyword', () => {
    render(<CommandPalette open onClose={vi.fn()} />);
    const search = screen.getByLabelText('搜索本地内容');
    fireEvent.change(search, { target: { value: 'pin' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(useNavigationStore.getState().tab).toBe('settings');
    expect(useNavigationStore.getState().settingsSection).toBe('account');
  });
});
