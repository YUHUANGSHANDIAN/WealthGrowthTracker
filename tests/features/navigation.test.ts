import { describe, it, expect } from 'vitest';
import { parseHash, buildHash, useNavigationStore } from '../../src/store/navigationStore';
import { SETTINGS_SECTIONS } from '../../src/constants/settings';

describe('navigation', () => {
  it('rejects unknown tabs and preserves valid bounded ranges', () => {
    expect(parseHash('#/unknown').tab).toBe('overview');
    const route = parseHash('#/analysis?startDate=2026-01-01&endDate=2026-01-31');
    expect(route.tab).toBe('analysis');
    expect(buildHash(route)).toContain('startDate=2026-01-01');
  });

  it.each(SETTINGS_SECTIONS)('round-trips the $label settings deep link', ({ id }) => {
    const hash = buildHash({ tab: 'settings', settingsSection: id });
    expect(hash).toBe('#/settings?section=' + id);
    expect(parseHash(hash).settingsSection).toBe(id);
  });

  it('rejects unknown categories and categories on other pages', () => {
    expect(parseHash('#/settings?section=unknown').settingsSection).toBeUndefined();
    expect(parseHash('#/analysis?section=privacy').settingsSection).toBeUndefined();
    expect(buildHash({ tab: 'analysis', settingsSection: 'privacy' })).toBe('#/analysis');
  });

  it('replaces old entity and settings context when navigating', () => {
    useNavigationStore.getState().navigate({ tab: 'reports', reportId: 'synthetic-report' });
    useNavigationStore.getState().navigate({ tab: 'settings', settingsSection: 'privacy' });
    expect(useNavigationStore.getState().reportId).toBeUndefined();
    useNavigationStore.getState().navigate({ tab: 'overview' });
    expect(useNavigationStore.getState().settingsSection).toBeUndefined();
    expect(window.location.hash).toBe('#/overview');
  });
});
