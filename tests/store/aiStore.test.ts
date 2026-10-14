import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAIConfigDrafts, useAIStore, type AIConfigDraft } from '../../src/store/aiStore';

const draft: AIConfigDraft = { id: 'profile-1', provider: 'openai', label: '模型备注', model: 'user-selected-model' };

beforeEach(() => {
  localStorage.clear();
  useAIStore.setState({ drafts: [], selectedDraftId: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AI configuration drafts', () => {
  it('downgrades old metadata to inert drafts and ignores claimed authorization', () => {
    const parsed = parseAIConfigDrafts(JSON.stringify({
      enabled: true,
      activeProfileId: draft.id,
      profiles: [{ ...draft, enabled: true, hasCredential: true, endpoint: 'https://example.test', scopes: ['all'], token: 'not-a-real-token' }],
    }));
    expect(parsed).toEqual({ drafts: [draft], selectedDraftId: draft.id });
    expect(parsed).not.toHaveProperty('enabled');
    expect(parsed.drafts[0]).not.toHaveProperty('hasCredential');
  });

  it('has no activation or authorization action', () => {
    expect(useAIStore.getState()).not.toHaveProperty('enabled');
    expect(useAIStore.getState()).not.toHaveProperty('setEnabled');
    expect(useAIStore.getState()).not.toHaveProperty('hasCredential');
  });

  it('persists only allowed draft fields and round-trips the selected draft', () => {
    useAIStore.getState().upsertDraft({ ...draft, enabled: true, hasCredential: true, apiKey: 'not-a-real-key' } as AIConfigDraft);
    useAIStore.getState().selectDraft(draft.id);
    const raw = localStorage.getItem('wealth_ai_metadata_v1');
    expect(parseAIConfigDrafts(raw)).toEqual({ drafts: [draft], selectedDraftId: draft.id });
    expect(raw).not.toContain('hasCredential');
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('enabled');
  });

  it('rejects invalid drafts and unavailable selected ids', () => {
    expect(() => useAIStore.getState().upsertDraft({ ...draft, model: '' })).toThrow('无效');
    useAIStore.getState().selectDraft('missing');
    expect(useAIStore.getState().selectedDraftId).toBeNull();
    expect(parseAIConfigDrafts('{bad json')).toEqual({ drafts: [], selectedDraftId: null });
    expect(parseAIConfigDrafts(JSON.stringify({ drafts: [{ ...draft, provider: 'unknown' }] }))).toEqual({ drafts: [], selectedDraftId: null });
  });

  it('keeps the unsaved draft out of state when storage fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
    expect(() => useAIStore.getState().upsertDraft(draft)).toThrow('storage denied');
    expect(useAIStore.getState().drafts).toHaveLength(0);
  });
});
