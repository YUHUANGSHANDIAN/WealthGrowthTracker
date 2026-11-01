import { create } from 'zustand';
import {
  configureAIProfile,
  disableAIProfile,
  removeAIProfile,
  setAIEnabled,
  validateConnectionProfile,
  type ConnectionProfile,
} from '../services/ai/client';

export type AIConnectionState = 'disconnected' | 'configured' | 'tested' | 'qualification-pending' | 'auth-error';
export type AIConnectionHealth = 'unknown' | 'healthy' | 'expired' | 'failed' | 'disabled';

export interface AIConnection extends ConnectionProfile {
  label: string;
  enabled: boolean;
  credentialRef: string;
  credentialPersisted: boolean;
  configRevision: number;
  capabilities: { text: boolean; vision: boolean; research: boolean };
  health: AIConnectionHealth;
  state: AIConnectionState;
  testedAt?: string;
  lastError?: string;
}

interface StoredConnections {
  schemaVersion: 2;
  activeProfileId: string | null;
  profiles: Array<Omit<AIConnection, 'state' | 'testedAt' | 'lastError'>>;
}

interface ConnectionsState {
  enabled: boolean;
  busy: boolean;
  connectionRevision: number;
  profiles: AIConnection[];
  activeProfileId: string | null;
  setEnabled: (enabled: boolean) => Promise<void>;
  connect: (profile: ConnectionProfile, label: string, credential?: string, persistCredential?: boolean) => Promise<void>;
  toggleEnabled: (profileId: string, enabled: boolean) => Promise<void>;
  activate: (profileId: string) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  select: (profileId: string) => void;
  markTested: (profileId: string) => void;
  markHealth: (profileId: string, health: AIConnectionHealth, error?: string) => void;
}

const KEY = 'wealth_ai_connections_v1';

function profileOf(connection: AIConnection): ConnectionProfile {
  return {
    profileId: connection.profileId,
    providerId: connection.providerId,
    authKind: connection.authKind,
    modelId: connection.modelId,
    ...(connection.endpoint ? { endpoint: connection.endpoint } : {}),
    ...(connection.supportsVision ? { supportsVision: true } : {}),
  };
}

function metadata(connection: AIConnection): Omit<AIConnection, 'state' | 'testedAt' | 'lastError'> {
  return {
    profileId: connection.profileId,
    providerId: connection.providerId,
    authKind: connection.authKind,
    label: connection.label,
    modelId: connection.modelId,
    ...(connection.endpoint ? { endpoint: connection.endpoint } : {}),
    ...(connection.supportsVision ? { supportsVision: true } : {}),
    enabled: connection.enabled,
    credentialRef: connection.credentialRef,
    credentialPersisted: connection.credentialPersisted,
    configRevision: connection.configRevision,
    capabilities: connection.capabilities,
    health: connection.health,
  };
}

function connectionsFromUnknown(value: unknown): { profiles: AIConnection[]; activeProfileId: string | null } {
  const profilesRaw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { profiles?: unknown }).profiles)
      ? (value as { profiles: unknown[] }).profiles
      : [];
  const requestedActive = value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { activeProfileId?: unknown }).activeProfileId === 'string'
    ? (value as { activeProfileId: string }).activeProfileId
    : null;
  const ids = new Set<string>();
  const profiles = profilesRaw.slice(0, 100).flatMap((raw): AIConnection[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Partial<AIConnection>;
    if (typeof item.profileId !== 'string' || ids.has(item.profileId)
      || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80
      || (item.endpoint !== undefined && (typeof item.endpoint !== 'string' || item.endpoint.length > 512))) return [];
    try {
      validateConnectionProfile(item as ConnectionProfile);
    } catch {
      return [];
    }
    ids.add(item.profileId);
    const enabled = item.enabled !== false;
    const configRevision = Number.isSafeInteger(item.configRevision) && (item.configRevision ?? 0) > 0 ? item.configRevision! : 1;
    return [{
      profileId: item.profileId,
      providerId: item.providerId!,
      authKind: item.authKind!,
      label: item.label.trim(),
      modelId: item.modelId!,
      ...(item.endpoint ? { endpoint: item.endpoint } : {}),
      ...(item.supportsVision ? { supportsVision: true } : {}),
      enabled,
      credentialRef: typeof item.credentialRef === 'string' && item.credentialRef.length <= 160
        ? item.credentialRef
        : `legacy:${item.profileId}`,
      credentialPersisted: item.credentialPersisted === undefined
        ? item.authKind !== 'local'
        : item.credentialPersisted === true,
      configRevision,
      capabilities: {
        text: true,
        vision: item.supportsVision === true,
        research: item.providerId !== 'copilot',
      },
      health: enabled ? (item.health ?? 'unknown') : 'disabled',
      state: 'disconnected',
    }];
  });
  return {
    profiles,
    activeProfileId: requestedActive && profiles.some((item) => item.profileId === requestedActive && item.enabled)
      ? requestedActive
      : null,
  };
}

function load(): { profiles: AIConnection[]; activeProfileId: string | null } {
  try {
    return connectionsFromUnknown(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return { profiles: [], activeProfileId: null };
  }
}

function save(profiles: AIConnection[], activeProfileId: string | null): void {
  const stored: StoredConnections = {
    schemaVersion: 2,
    activeProfileId,
    profiles: profiles.map(metadata),
  };
  localStorage.setItem(KEY, JSON.stringify(stored));
}

function unavailable(profile: AIConnection, state: AIConnectionState = 'disconnected', error?: string): AIConnection {
  return {
    ...profile,
    state,
    health: error ? 'failed' : profile.enabled ? 'unknown' : 'disabled',
    ...(error ? { lastError: error } : {}),
  };
}

const initial = load();

export const useAIConnectionStore = create<ConnectionsState>()((set, get) => ({
  enabled: false,
  busy: false,
  connectionRevision: 0,
  profiles: initial.profiles,
  activeProfileId: initial.activeProfileId,
  async setEnabled(enabled) {
    if (get().busy) throw new Error('连接操作进行中，请稍后重试');
    set({ busy: true, connectionRevision: get().connectionRevision + 1 });
    try {
      await setAIEnabled(enabled);
      const profiles = get().profiles.map((profile) => enabled ? profile : unavailable(profile));
      set({ enabled, profiles });
      save(profiles, get().activeProfileId);
    } finally {
      set({ busy: false });
    }
  },
  async connect(profile, label, credential, persistCredential = false) {
    if (get().busy || !get().enabled) throw new Error('请先启用 AI，并等待当前连接操作完成');
    if (!label.trim() || label.length > 80) throw new Error('连接名称无效');
    validateConnectionProfile(profile);
    if (get().profiles.length >= 100 && !get().profiles.some((item) => item.profileId === profile.profileId)) {
      throw new Error('连接数量已达上限');
    }
    set({ busy: true, connectionRevision: get().connectionRevision + 1 });
    try {
      const result = await configureAIProfile(profile, credential, persistCredential);
      const existing = get().profiles.find((item) => item.profileId === profile.profileId);
      const connection: AIConnection = {
        ...profile,
        label: label.trim(),
        enabled: true,
        credentialRef: existing?.credentialRef ?? `profile:${profile.profileId}`,
        credentialPersisted: persistCredential,
        configRevision: (existing?.configRevision ?? 0) + 1,
        capabilities: {
          text: true,
          vision: profile.supportsVision === true,
          research: profile.providerId !== 'copilot',
        },
        health: 'healthy',
        state: result.state,
      };
      const profiles = [...get().profiles.filter((item) => item.profileId !== profile.profileId), connection];
      const activeProfileId = get().activeProfileId ?? connection.profileId;
      save(profiles, activeProfileId);
      set({ profiles, activeProfileId });
    } finally {
      set({ busy: false });
    }
  },
  async toggleEnabled(profileId, enabled) {
    if (get().busy) throw new Error('连接操作进行中，请稍后重试');
    const connection = get().profiles.find((item) => item.profileId === profileId);
    if (!connection) throw new Error('连接不存在');
    if (enabled && !get().enabled) throw new Error('请先启用 AI');
    if (enabled && connection.authKind !== 'local' && !connection.credentialPersisted) {
      throw new Error('此连接只使用临时凭据，停用后需重新填写凭据并连接');
    }
    set({ busy: true, connectionRevision: get().connectionRevision + 1 });
    try {
      if (enabled) {
        const result = await configureAIProfile(profileOf(connection), undefined, connection.credentialPersisted);
        const profiles = get().profiles.map((item) => item.profileId === profileId
          ? { ...item, enabled: true, state: result.state, health: 'healthy' as const, configRevision: item.configRevision + 1 }
          : item);
        save(profiles, get().activeProfileId);
        set({ profiles });
      } else {
        await disableAIProfile(profileId);
        const profiles = get().profiles.map((item) => item.profileId === profileId
          ? { ...item, enabled: false, state: 'disconnected' as const, health: 'disabled' as const, configRevision: item.configRevision + 1 }
          : item);
        const activeProfileId = get().activeProfileId === profileId ? null : get().activeProfileId;
        save(profiles, activeProfileId);
        set({ profiles, activeProfileId });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '连接启用失败';
      const profiles = get().profiles.map((item) => item.profileId === profileId
        ? unavailable({ ...item, enabled: false }, 'auth-error', message)
        : item);
      save(profiles, get().activeProfileId);
      set({ profiles });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  },
  async activate(profileId) {
    if (get().busy) throw new Error('连接操作进行中，请稍后重试');
    if (!get().enabled) throw new Error('请先启用 AI');
    const connection = get().profiles.find((item) => item.profileId === profileId);
    if (!connection?.enabled) throw new Error('此连接已停用，请先启用');
    set({ busy: true, connectionRevision: get().connectionRevision + 1 });
    try {
      const result = await configureAIProfile(profileOf(connection), undefined, connection.credentialPersisted);
      const profiles = get().profiles.map((item) => item.profileId === profileId
        ? { ...item, state: result.state, health: 'healthy' as const, configRevision: item.configRevision + 1 }
        : item);
      save(profiles, profileId);
      set({ profiles, activeProfileId: profileId });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '切换连接失败';
      const profiles = get().profiles.map((item) => item.profileId === profileId
        ? unavailable(item, 'auth-error', message)
        : item);
      save(profiles, get().activeProfileId);
      set({ profiles });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  },
  async disconnect(profileId) {
    if (get().busy) throw new Error('连接操作进行中，请稍后重试');
    set({ busy: true, connectionRevision: get().connectionRevision + 1 });
    try {
      const target = get().profiles.find((item) => item.profileId === profileId);
      const shared = Boolean(target && get().profiles.some((item) =>
        item.profileId !== profileId && item.credentialRef === target.credentialRef));
      await removeAIProfile(profileId, shared);
      const profiles = get().profiles.filter((item) => item.profileId !== profileId);
      const activeProfileId = get().activeProfileId === profileId ? null : get().activeProfileId;
      save(profiles, activeProfileId);
      set({ profiles, activeProfileId });
    } finally {
      set({ busy: false });
    }
  },
  select(profileId) {
    const connection = get().profiles.find((item) => item.profileId === profileId);
    if (connection?.enabled && ['configured', 'tested'].includes(connection.state)) {
      set({ activeProfileId: profileId, connectionRevision: get().connectionRevision + 1 });
    }
  },
  markTested(profileId) {
    const profiles = get().profiles.map((item) => item.profileId === profileId && ['configured', 'tested'].includes(item.state)
      ? { ...item, state: 'tested' as const, health: 'healthy' as const, testedAt: new Date().toISOString() }
      : item);
    set({ profiles });
    save(profiles, get().activeProfileId);
  },
  markHealth(profileId, health, error) {
    const profiles = get().profiles.map((item) => item.profileId === profileId
      ? { ...item, health, ...(error ? { lastError: error } : {}) }
      : item);
    set({ profiles });
    save(profiles, get().activeProfileId);
  },
}));

/** Restore non-secret connection metadata from a full backup; credentials always require reauthorization. */
export function restoreAIConnectionMetadata(raw: string): number {
  const parsed = connectionsFromUnknown(JSON.parse(raw) as unknown);
  useAIConnectionStore.setState({
    enabled: false,
    busy: false,
    connectionRevision: 0,
    profiles: parsed.profiles.map((profile) => unavailable(profile)),
    activeProfileId: parsed.activeProfileId,
  });
  save(parsed.profiles.map((profile) => unavailable(profile)), parsed.activeProfileId);
  return parsed.profiles.length;
}
