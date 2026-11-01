import { describe, it, expect } from 'vitest';
import { MAIN_SECTION_IDS, parseHash, buildHash, useNavigationStore } from '../../src/store/navigationStore';
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
    expect(buildHash({ tab: 'analysis', settingsSection: 'privacy' })).toBe('#/review/analysis');
  });

  it('maps the five main sections, auxiliary entries and old deep links', () => {
    expect(parseHash('#/finance/initial-reconciliation')).toMatchObject({
      tab: 'monthly', financeTaskKind: 'initial-reconciliation',
    });
    expect(parseHash('#/review/reports/report/r1')).toMatchObject({ tab: 'reports', reportId: 'r1' });
    expect(parseHash('#/planning/prediction')).toMatchObject({ tab: 'prediction' });
    expect(parseHash('#/settings/ai')).toMatchObject({ tab: 'ai', settingsSection: 'ai' });
    expect(parseHash('#/settings/storage')).toMatchObject({ tab: 'data', settingsSection: 'storage' });
    expect(parseHash('#/reports/report/legacy')).toMatchObject({ tab: 'reports', reportId: 'legacy' });
    expect(new Set(MAIN_SECTION_IDS)).toEqual(new Set(['overview', 'assets', 'finance', 'review', 'planning', 'lottery', 'settings']));
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
