import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIWorkspace } from '../../src/features/ai/AIWorkspace';
import { useAIWorkspaceStore } from '../../src/store/aiWorkspaceStore';
import { useAIConnectionStore } from '../../src/store/aiConnectionStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { useAppStore } from '../../src/store/appStore';
import { setAIEnabled, type ConnectionProfile } from '../../src/services/ai/client';

const profile: ConnectionProfile = {
  profileId: 'workspace-gateway', providerId: 'gateway', authKind: 'api-key', modelId: 'test-model',
  endpoint: 'https://gateway.example.com/v1',
};

beforeEach(async () => {
  localStorage.clear();
  useAppStore.setState({
    hydrated: true, recoveryError: null, maintenanceLabel: null,
    channels: [{ id: 'cash', name: '现金', emoji: '💵', amount: 1_000, color: '#000', isParent: true, isExpanded: false }],
    history: [{ date: '2026-10-01', totalAmount: 800 }, { date: '2026-10-12', totalAmount: 1_000 }],
    reports: [], levelAchievements: [], goalAchieved: { hasAchievedGoal: false }, toasts: [],
  });
  useWorkspaceStore.setState({ amountsHidden: false });
  useAIWorkspaceStore.setState({ target: null });
  await setAIEnabled(true);
  useAIConnectionStore.setState({ enabled: true, busy: false, connectionRevision: 1, profiles: [], activeProfileId: null });
  await useAIConnectionStore.getState().connect(profile, '测试网关', 'sk-synthetic-value', false);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAIWorkspaceStore.setState({ target: null });
  await setAIEnabled(false);
  useAIConnectionStore.setState({ enabled: false, activeProfileId: null, profiles: [], connectionRevision: 0 });
  useAppStore.setState({ hydrated: false, maintenanceLabel: null });
});

function openWorkspace() {
  useAIWorkspaceStore.setState({ target: { task: 'analysis-question', range: { start: '2026-10-01', end: '2026-10-13' } } });
  render(<AIWorkspace />);
}

function modelReply(cited: (facts: Array<{ factId: string }>) => string) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const facts = (JSON.parse(body.messages[1]!.content) as { facts: Array<{ factId: string }> }).facts;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: '区间概览', observations: [{ text: '区间资产上升', factIds: [cited(facts)] }], limitations: ['未提供现金流'],
      }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('AI workspace authorization flow', () => {
  it('shows the exact context before sending and cites authorized facts in the result', async () => {
    const fetchMock = modelReply(facts => facts[0]!.factId);
    vi.stubGlobal('fetch', fetchMock);
    openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: '预览本次发送内容' }));
    const manifest = await screen.findByLabelText('ContextManifest');
    expect(manifest.textContent).toContain('区间起点资产');
    expect(manifest.textContent).toContain('local:metrics');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '授权发送这一次' }));
    await screen.findByText('区间资产上升');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]!;
    expect(String(request[0])).toBe('https://gateway.example.com/v1/chat/completions');
    expect((request[1]?.headers as Record<string, string>).Authorization).toBe('Bearer sk-synthetic-value');
    expect(screen.getByText(/输入 tokens：12/)).toBeInTheDocument();
  });

  it('rejects model output that cites a fact id which was never authorized', async () => {
    vi.stubGlobal('fetch', modelReply(() => 'forged.fact'));
    openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: '预览本次发送内容' }));
    await screen.findByLabelText('ContextManifest');
    fireEvent.click(screen.getByRole('button', { name: '授权发送这一次' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('未授权');
    expect(screen.queryByText('区间资产上升')).not.toBeInTheDocument();
  });

  it('pauses business AI while amounts are hidden and cancels pending requests on close', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => {
      gate.release = () => resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    })));
    openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: '预览本次发送内容' }));
    await screen.findByLabelText('ContextManifest');
    fireEvent.click(screen.getByRole('button', { name: '授权发送这一次' }));
    expect(await screen.findByRole('button', { name: '取消请求' })).toBeInTheDocument();
    useWorkspaceStore.setState({ amountsHidden: true });
    await waitFor(() => expect(screen.getByText(/金额隐私已开启/)).toBeInTheDocument());
    gate.release?.();
    expect(screen.queryByText('区间资产上升')).not.toBeInTheDocument();
  });
});
