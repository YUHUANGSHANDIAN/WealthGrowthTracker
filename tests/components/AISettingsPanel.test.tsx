import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AIConnectionCenter } from '../../src/features/ai/AIConnectionCenter';
import { useAIConnectionStore } from '../../src/store/aiConnectionStore';
import { setAIEnabled } from '../../src/services/ai/client';

beforeEach(async () => {
  localStorage.clear();
  await setAIEnabled(false);
  useAIConnectionStore.setState({ enabled: false, busy: false, connectionRevision: 0, profiles: [], activeProfileId: null });
});
afterEach(async () => { await setAIEnabled(false); });

describe('AI connection center', () => {
  it('is off by default and explains why before any connection exists', () => {
    render(<AIConnectionCenter />);
    expect(screen.getByText('AI 未启用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用 AI' })).toBeInTheDocument();
    expect(screen.queryByText('新增连接')).not.toBeInTheDocument();
    expect(screen.queryByText('合成测试通过')).not.toBeInTheDocument();
  });

  it('blocks official cloud services on the web platform after enabling', async () => {
    render(<AIConnectionCenter />);
    fireEvent.click(screen.getByRole('button', { name: '启用 AI' }));
    await screen.findByText('AI 已启用');
    expect(screen.getByLabelText('连接类型')).toBeInTheDocument();
    expect(screen.getByText('此平台不直接连接官方云服务，请改用用户自建 HTTPS 网关或本地端点。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '连接并注册' })).toBeDisabled();
  });

  it('registers a local endpoint connection without storing credentials', async () => {
    render(<AIConnectionCenter />);
    fireEvent.click(screen.getByRole('button', { name: '启用 AI' }));
    await screen.findByText('AI 已启用');
    fireEvent.change(screen.getByLabelText('连接类型'), { target: { value: 'ollama' } });
    fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '本地测试模型' } });
    fireEvent.change(screen.getByLabelText('模型标识'), { target: { value: 'qwen3:8b' } });
    fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://localhost:11434/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并注册' }));
    await screen.findByText('本地测试模型');
    expect(screen.getByText(/已配置/)).toBeInTheDocument();
    const stored = localStorage.getItem('wealth_ai_connections_v1') ?? '';
    expect(stored).toContain('本地测试模型');
    expect(stored).not.toMatch(/sk-|token|secret/i);
    expect(useAIConnectionStore.getState().profiles).toHaveLength(1);
  });
});
