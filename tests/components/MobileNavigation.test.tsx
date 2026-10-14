import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TAB_IDS, useNavigationStore } from '../../src/store/navigationStore';
import { MOBILE_MORE_ITEMS, MOBILE_PRIMARY_ITEMS } from '../../src/constants/navigation';
import { MobileNavigation } from '../../src/features/workspace/MobileNavigation';

describe('MobileNavigation', () => {
  beforeEach(() => {
    useNavigationStore.getState().navigate({ tab: 'overview' });
  });

  afterEach(() => {
    cleanup();
    useNavigationStore.getState().navigate({ tab: 'overview' });
  });

  it('makes every tab discoverable from the primary bar or More menu', () => {
    const visibleTabs = [...MOBILE_PRIMARY_ITEMS, ...MOBILE_MORE_ITEMS].map((item) => item.id);
    expect(new Set(visibleTabs)).toEqual(new Set(TAB_IDS));

    render(<MobileNavigation />);
    expect(screen.getByRole('navigation', { name: '移动导航' })).toBeInTheDocument();
    for (const item of MOBILE_PRIMARY_ITEMS) {
      expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    for (const item of MOBILE_MORE_ITEMS) {
      expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  });

  it.each(MOBILE_MORE_ITEMS)('navigates to $label and marks the current route', async (item) => {
    const user = userEvent.setup();
    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('button', { name: item.label }));

    expect(useNavigationStore.getState().tab).toBe(item.id);
    expect(screen.queryByRole('dialog', { name: '更多页面' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('button', { name: item.label })).toHaveAttribute('aria-current', 'page');
  });

  it('closes on Escape and restores focus to the More trigger', async () => {
    const user = userEvent.setup();
    render(<MobileNavigation />);
    const trigger = screen.getByRole('button', { name: '更多' });

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '更多页面' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '设置' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '更多页面' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens the settings page and closes More', async () => {
    const user = userEvent.setup();
    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('button', { name: '设置' }));

    expect(useNavigationStore.getState().tab).toBe('settings');
    expect(window.location.hash).toBe('#/settings');
    expect(screen.queryByRole('dialog', { name: '更多页面' })).not.toBeInTheDocument();
  });
});
