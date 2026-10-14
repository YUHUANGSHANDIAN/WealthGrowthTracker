import { create } from 'zustand';
import { configureAIProfile, removeAIProfile, setAIEnabled, validateConnectionProfile, type ConnectionProfile } from '../services/ai/client';

export interface AIConnection extends ConnectionProfile {
  label: string;
  state: 'disconnected' | 'configured' | 'tested' | 'qualification-pending';
  testedAt?: string;
}
interface ConnectionsState {
  enabled: boolean;
  busy: boolean;
  connectionRevision: number;
  profiles: AIConnection[];
  activeProfileId: string | null;
  setEnabled: (enabled: boolean) => Promise<void>;
  connect: (profile: ConnectionProfile, label: string, credential?: string, persistCredential?: boolean) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  select: (profileId: string) => void;
  markTested: (profileId: string) => void;
}
const key = 'wealth_ai_connections_v1';
function metadata(profile: AIConnection): Omit<AIConnection, 'state' | 'testedAt'> {
  return { profileId: profile.profileId, providerId: profile.providerId, authKind: profile.authKind,
    label: profile.label, modelId: profile.modelId, ...(profile.endpoint ? { endpoint: profile.endpoint } : {}) };
}
function load(): AIConnection[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.slice(0, 100).flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const p = item as AIConnection;
      if (typeof p.profileId !== 'string' || ids.has(p.profileId) || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 80
        || (p.endpoint !== undefined && (typeof p.endpoint !== 'string' || p.endpoint.length > 512))) return [];
      try { validateConnectionProfile(p); } catch { return []; }
      ids.add(p.profileId);
      return [{ ...metadata(p), state: 'disconnected' as const }];
    });
  } catch { return []; }
}
function save(profiles: AIConnection[]) { localStorage.setItem(key, JSON.stringify(profiles.map(metadata))); }

export const useAIConnectionStore = create<ConnectionsState>()((set, get) => ({
  enabled: false, busy: false, connectionRevision: 0, profiles: load(), activeProfileId: null,
  async setEnabled(enabled) {
    if (get().busy) throw new Error('连接操作进行中，请稍后重试');
    set({ busy: true, connectionRevision: get().connectionRevision + 1, ...(!enabled ? { enabled: false, activeProfileId: null, profiles: get().profiles.map(p => ({ ...metadata(p), state: 'disconnected' as const })) } : {}) });
    try {
      await setAIEnabled(enabled);
      set({ enabled, ...(!enabled ? { profiles: get().profiles.map(p => ({ ...metadata(p), state: 'disconnected' as const })), activeProfileId: null } : {}) });
    } finally { set({ busy: false }); }
  },
  async connect(profile, label, credential, persistCredential = false) {
    if (get().busy || !get().enabled) throw new Error('请先启用 AI，并等待当前连接操作完成');
    if (!label.trim() || label.length > 80) throw new Error('连接名称无效');
    validateConnectionProfile(profile);
    if (get().profiles.length >= 100 && !get().profiles.some(p => p.profileId === profile.profileId)) throw new Error('连接数量已达上限');
    set({ busy: true, connectionRevision: get().connectionRevision + 1, profiles: get().profiles.map(p => p.profileId === profile.profileId ? { ...p, state: 'disconnected' as const } : p) });
    try {
      const result = await configureAIProfile(profile, credential, persistCredential);
      const connection: AIConnection = { ...metadata({ ...profile, label: label.trim(), state: result.state }), state: result.state };
      const profiles = [...get().profiles.filter(p => p.profileId !== profile.profileId), connection];
      try { save(profiles); } catch {
        await removeAIProfile(profile.profileId);
        throw new Error('连接元数据保存失败；请检查本机存储权限');
      }
      set({ profiles, activeProfileId: profile.profileId });
    } finally { set({ busy: false }); }
  },
  async disconnect(profileId) {
    if (get().busy) throw new Error('连接操作进行中，请稍后重试');
    set({ busy: true, connectionRevision: get().connectionRevision + 1 });
    try {
      await removeAIProfile(profileId);
      const profiles = get().profiles.filter(p => p.profileId !== profileId);
      set({ profiles, activeProfileId: get().activeProfileId === profileId ? null : get().activeProfileId });
      save(profiles);
    } finally { set({ busy: false }); }
  },
  select(profileId) {
    if (get().activeProfileId !== profileId && get().profiles.some(p => p.profileId === profileId && ['configured', 'tested'].includes(p.state))) set({ activeProfileId: profileId, connectionRevision: get().connectionRevision + 1 });
  },
  markTested(profileId) {
    set({ profiles: get().profiles.map(p => p.profileId === profileId && p.state === 'configured' ? { ...p, state: 'tested', testedAt: new Date().toISOString() } : p) });
  },
}));
