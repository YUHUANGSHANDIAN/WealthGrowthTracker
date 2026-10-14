import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAIConnectionStore } from '../../src/store/aiConnectionStore';
import { setAIEnabled, type ConnectionProfile } from '../../src/services/ai/client';

const gateway: ConnectionProfile = {
  profileId: 'gateway-1', providerId: 'gateway', authKind: 'api-key', modelId: 'my-model',
  endpoint: 'https://gateway.example.com/v1',
};

beforeEach(async () => {
  localStorage.clear();
  await setAIEnabled(false);
  useAIConnectionStore.setState({ enabled: false, busy: false, connectionRevision: 0, profiles: [], activeProfileId: null });
});
afterEach(async () => { await setAIEnabled(false); });

describe('AI connection store', () => {
  it('starts disabled and refuses connections before enabling', async () => {
    await expect(useAIConnectionStore.getState().connect(gateway, '我的网关', 'sk-secret', false)).rejects.toThrow('启用');
    expect(useAIConnectionStore.getState().profiles).toHaveLength(0);
  });

  it('never writes credentials into connection metadata', async () => {
    await useAIConnectionStore.getState().setEnabled(true);
    await useAIConnectionStore.getState().connect(gateway, '我的网关', 'sk-secret-value', false);
    const stored = localStorage.getItem('wealth_ai_connections_v1') ?? '';
    expect(stored).toContain('gateway-1');
    expect(stored).not.toContain('sk-secret-value');
    expect(stored).not.toMatch(/sk-|token|secret|authorization/i);
    // Temporary session credential stays out of metadata but the connection is active.
    expect(useAIConnectionStore.getState().activeProfileId).toBe('gateway-1');
    expect(useAIConnectionStore.getState().profiles[0]?.state).toBe('configured');
  });

  it('rejects auth kinds that do not belong to the provider', async () => {
    await useAIConnectionStore.getState().setEnabled(true);
    await expect(useAIConnectionStore.getState().connect(
      { ...gateway, profileId: 'copilot-1', providerId: 'copilot', authKind: 'api-key' }, '错误组合', 'sk', false,
    )).rejects.toThrow('不一致');
    expect(useAIConnectionStore.getState().profiles).toHaveLength(0);
  });

  it('only activates configured connections and only marks configured ones as tested', async () => {
    await useAIConnectionStore.getState().setEnabled(true);
    await useAIConnectionStore.getState().connect(gateway, '我的网关', 'sk-secret', false);
    useAIConnectionStore.getState().select('unknown');
    expect(useAIConnectionStore.getState().activeProfileId).toBe('gateway-1');
    useAIConnectionStore.getState().markTested('gateway-1');
    expect(useAIConnectionStore.getState().profiles[0]?.state).toBe('tested');
    useAIConnectionStore.getState().markTested('gateway-1');
    expect(useAIConnectionStore.getState().profiles[0]?.state).toBe('tested');
  });

  it('disabling AI disconnects every profile and clears the active selection', async () => {
    await useAIConnectionStore.getState().setEnabled(true);
    await useAIConnectionStore.getState().connect(gateway, '我的网关', 'sk-secret', false);
    await useAIConnectionStore.getState().setEnabled(false);
    const state = useAIConnectionStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.activeProfileId).toBeNull();
    expect(state.profiles[0]?.state).toBe('disconnected');
    expect(state.connectionRevision).toBeGreaterThan(0);
  });

  it('removes a connection and its metadata together', async () => {
    await useAIConnectionStore.getState().setEnabled(true);
    await useAIConnectionStore.getState().connect(gateway, '我的网关', 'sk-secret', false);
    await useAIConnectionStore.getState().disconnect('gateway-1');
    expect(useAIConnectionStore.getState().profiles).toHaveLength(0);
    expect(useAIConnectionStore.getState().activeProfileId).toBeNull();
    const stored = localStorage.getItem('wealth_ai_connections_v1') ?? '[]';
    expect(JSON.parse(stored)).toEqual([]);
  });
});
