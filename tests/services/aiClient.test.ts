import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureAIProfile, researchLookupAI, setAIEnabled, validateConnectionProfile, visionExtractAI,
  type ConnectionProfile,
} from '../../src/services/ai/client';

const gateway: ConnectionProfile = {
  profileId: 'profile-gateway', providerId: 'gateway', authKind: 'api-key',
  modelId: 'synthetic-vision', endpoint: 'https://gateway.example.com/v1',
};
const image = { mimeType: 'image/png' as const, data: 'aGVsbG8=' };
const vision = (overrides: Partial<Parameters<typeof visionExtractAI>[0]> = {}) => ({
  requestId: crypto.randomUUID(), profileId: gateway.profileId, providerId: 'gateway' as const,
  task: 'document-extraction' as const, input: { images: [image] }, ...overrides,
});

beforeEach(async () => {
  await setAIEnabled(false);
  await setAIEnabled(true);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await setAIEnabled(false);
});

describe('AI client vision and research boundaries', () => {
  it('refuses every vision request without a declared image capability', async () => {
    await configureAIProfile(gateway, 'synthetic-credential');
    await expect(visionExtractAI(vision())).rejects.toThrow('此连接未被声明为可读图');
    validateConnectionProfile(gateway);
    expect(() => validateConnectionProfile({ ...gateway, supportsVision: 'yes' as unknown as boolean })).toThrow('读图能力必须是布尔值');
    expect(() => validateConnectionProfile({
      profileId: 'profile-copilot', providerId: 'copilot', authKind: 'copilot-subscription', modelId: 'synthetic', supportsVision: true,
    })).toThrow('此连接不支持图片输入');
  });

  it('bounds image count, MIME type, encoding and size before any provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await configureAIProfile({ ...gateway, supportsVision: true }, 'synthetic-credential');
    const invalid: [unknown, string][] = [
      [{ images: [] }, '图片数量必须在 1 到 4 张之间'],
      [{ images: Array.from({ length: 5 }, () => image) }, '图片数量必须在 1 到 4 张之间'],
      [{ images: [{ mimeType: 'image/gif', data: 'aGVsbG8=' }] }, '仅支持 PNG、JPEG 或 WebP 图片'],
      [{ images: [{ mimeType: 'image/png', data: 'not base64!' }] }, '图片数据必须是未压缩的 base64 文本'],
      [{ images: [{ mimeType: 'image/png', data: 'A'.repeat(1_500_001) }] }, '单张图片超过体积上限'],
      [{ images: [0, 1, 2].map(() => ({ mimeType: 'image/png', data: 'A'.repeat(1_100_000) })) }, '图片总量超过上限'],
      [{ images: [image], text: 'x'.repeat(8_001) }, '说明文本超出长度限制'],
      [{ images: [image], facts: new Array(49).fill({ factId: 'f', label: 'l', value: '1', unit: 'CNY' }) }, '引用事实超出数量限制'],
    ];
    for (const [input, message] of invalid) {
      await expect(visionExtractAI(vision({ input: input as never }))).rejects.toThrow(message);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends images as explicit user-approved data URLs on a declared connection', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"fields":[]}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await configureAIProfile({ ...gateway, supportsVision: true }, 'synthetic-credential');
    const result = await visionExtractAI(vision({ input: { images: [image], text: '只提取可见金额，未知留空' } }));
    expect(result.text).toBe('{"fields":[]}');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: expect.stringContaining('未知留空') });
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/png;base64,aGVsbG8=');
    expect(JSON.stringify(body)).not.toContain('synthetic-credential');
  });

  it('keeps research unavailable off desktop instead of silently substituting a search engine', async () => {
    await configureAIProfile(gateway, 'synthetic-credential');
    const request = { requestId: crypto.randomUUID(), profileId: gateway.profileId, providerId: 'gateway' as const };
    await expect(researchLookupAI({ ...request, urls: ['https://example.com/a'] })).rejects.toThrow('当前平台不提供联网检索');
    for (const url of ['http://example.com/a', 'https://user:pass@example.com/a', 'https://example.com/a#f', 'not-a-url', `https://example.com/${'a'.repeat(2_049)}`]) {
      await expect(researchLookupAI({ ...request, urls: [url] })).rejects.toThrow('只能检索公开的 HTTPS 链接');
    }
    await expect(researchLookupAI({ ...request, urls: ['https://example.com/a', 'https://example.com/a'] })).rejects.toThrow('1 到 5 个互不重复');
    await expect(researchLookupAI({ ...request, urls: Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`) }))
      .rejects.toThrow('1 到 5 个互不重复');
  });

  it('accepts the monthly planning tasks that ship with this version', async () => {
    const tasks = ['document-extraction', 'attribution-explanation', 'research-summary', 'monthly-narrative'] as const;
    for (const task of tasks) {
      const { inferAI } = await import('../../src/services/ai/client');
      await expect(inferAI({
        requestId: crypto.randomUUID(), profileId: gateway.profileId, providerId: 'gateway',
        task, input: { text: '合成消息', facts: [] },
      })).rejects.toThrow('连接与授权提供商不一致');
    }
  });
});
