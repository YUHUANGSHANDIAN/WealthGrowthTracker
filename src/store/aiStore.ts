import { create } from 'zustand';

export type AIProvider = 'openai' | 'anthropic' | 'deepseek' | 'local';

export interface AIConfigDraft {
  id: string;
  provider: AIProvider;
  label: string;
  model: string;
}

interface AIState {
  drafts: AIConfigDraft[];
  selectedDraftId: string | null;
  upsertDraft: (draft: AIConfigDraft) => void;
  removeDraft: (id: string) => void;
  selectDraft: (id: string | null) => void;
}

const key = 'wealth_ai_metadata_v1';
const providers = new Set<AIProvider>(['openai', 'anthropic', 'deepseek', 'local']);

function normalizeDraft(item: unknown): AIConfigDraft | null {
  if (!item || typeof item !== 'object') return null;
  const draft = item as Record<string, unknown>;
  if (
    typeof draft.id !== 'string' || !draft.id || draft.id.length > 128 ||
    typeof draft.provider !== 'string' || !providers.has(draft.provider as AIProvider) ||
    typeof draft.label !== 'string' || !draft.label.trim() || draft.label.length > 80 ||
    typeof draft.model !== 'string' || !draft.model.trim() || draft.model.length > 128
  ) return null;
  // Credentials and authorization flags are never metadata. Ignore legacy fields.
  return {
    id: draft.id,
    provider: draft.provider as AIProvider,
    label: draft.label.trim(),
    model: draft.model.trim(),
  };
}

export function parseAIConfigDrafts(raw: string | null): Pick<AIState, 'drafts' | 'selectedDraftId'> {
  if (!raw) return { drafts: [], selectedDraftId: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { drafts: [], selectedDraftId: null };
    const record = value as Record<string, unknown>;
    const storedDrafts = Array.isArray(record.drafts) ? record.drafts : record.profiles;
    const validDrafts = Array.isArray(storedDrafts) ? storedDrafts.map(normalizeDraft).filter((draft) => draft !== null) : [];
    const drafts = [...new Map(validDrafts.map((draft) => [draft.id, draft])).values()];
    const requestedSelection = typeof record.selectedDraftId === 'string'
      ? record.selectedDraftId
      : typeof record.activeProfileId === 'string' ? record.activeProfileId : null;
    return {
      drafts,
      selectedDraftId: drafts.some((draft) => draft.id === requestedSelection) ? requestedSelection : null,
    };
  } catch {
    return { drafts: [], selectedDraftId: null };
  }
}

function load(): Pick<AIState, 'drafts' | 'selectedDraftId'> {
  try {
    return parseAIConfigDrafts(localStorage.getItem(key));
  } catch {
    return { drafts: [], selectedDraftId: null };
  }
}

function save(state: Pick<AIState, 'drafts' | 'selectedDraftId'>) {
  localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, ...state }));
}

export const useAIStore = create<AIState>()((set, get) => ({
  ...load(),
  upsertDraft(draft) {
    const normalized = normalizeDraft(draft);
    if (!normalized) throw new Error('配置草稿格式无效');
    const drafts = [...get().drafts.filter((item) => item.id !== normalized.id), normalized];
    const next = { drafts, selectedDraftId: get().selectedDraftId };
    save(next);
    set(next);
  },
  removeDraft(id) {
    const drafts = get().drafts.filter((draft) => draft.id !== id);
    const selectedDraftId = get().selectedDraftId === id ? null : get().selectedDraftId;
    const next = { drafts, selectedDraftId };
    save(next);
    set(next);
  },
  selectDraft(selectedDraftId) {
    if (selectedDraftId && !get().drafts.some((draft) => draft.id === selectedDraftId)) return;
    const next = { drafts: get().drafts, selectedDraftId };
    save(next);
    set(next);
  },
}));
