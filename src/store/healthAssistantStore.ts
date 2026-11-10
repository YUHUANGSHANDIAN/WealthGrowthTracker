import { create } from 'zustand';
import {
  HEALTH_ASSISTANT_STORAGE_KEY,
  parseHealthAssistantState,
  pruneHealthAssistantState,
  upsertHealthConversation,
} from '../domain/healthAssistant/state';
import type {
  HealthAssistantConversation,
  HealthAssistantRetention,
  HealthAssistantState,
} from '../domain/healthAssistant/types';
import { storageService } from '../services/storage';

interface HealthAssistantStoreState {
  hydrated: boolean;
  loading: boolean;
  loadError: string | null;
  state: HealthAssistantState;
  load: (force?: boolean) => Promise<void>;
  saveSettings: (retention: HealthAssistantRetention, includeInFullBackup: boolean) => Promise<void>;
  saveConversation: (conversation: HealthAssistantConversation) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
}

const empty = parseHealthAssistantState(null);

async function persist(state: HealthAssistantState): Promise<void> {
  await storageService.setJSON(HEALTH_ASSISTANT_STORAGE_KEY, state);
  await storageService.flushAdapter();
}

export const useHealthAssistantStore = create<HealthAssistantStoreState>()((set, get) => ({
  hydrated: false,
  loading: false,
  loadError: null,
  state: empty,
  async load(force = false) {
    if (get().loading || (get().hydrated && !force)) return;
    set({ loading: true, loadError: null });
    try {
      const raw = await storageService.getRaw(HEALTH_ASSISTANT_STORAGE_KEY);
      const parsed = raw === null ? empty : parseHealthAssistantState(JSON.parse(raw) as unknown);
      const current = pruneHealthAssistantState(parsed);
      if (raw !== null && JSON.stringify(current) !== JSON.stringify(parsed)) await persist(current);
      set({ hydrated: true, loading: false, state: current });
    } catch (error) {
      set({ loading: false, loadError: error instanceof Error ? error.message : '无法读取健康助手本地会话' });
    }
  },
  async saveSettings(retention, includeInFullBackup) {
    const next = { ...get().state, retention, includeInFullBackup };
    await persist(next);
    set({ state: next });
  },
  async saveConversation(conversation) {
    const next = pruneHealthAssistantState(upsertHealthConversation(get().state, conversation));
    await persist(next);
    set({ state: next });
  },
  async removeConversation(id) {
    const next = {
      ...get().state,
      conversations: get().state.conversations.filter((item) => item.id !== id),
    };
    await persist(next);
    set({ state: next });
  },
}));
