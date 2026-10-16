import { describe, expect, it } from 'vitest';
import {
  VISION_INSTRUCTION, buildVisionRequest, existingResearchUrls, parseUrlLines, researchEvidenceFrom, visionMimeFor,
} from '../../src/features/monthlyPlanning/aiEntry';
import { bytesToBase64 } from '../../src/services/monthlyPlanning/attachments';
import type { ResearchSource } from '../../src/services/ai/client';
import type { ResearchEvidence } from '../../src/domain/portfolio/types';

const document = (extension: string, mime = '') => ({
  id: `doc:${extension}`, mime, relativePath: `monthly-attach:${'a'.repeat(64)}.${extension}`,
  originalName: `票据.${extension}`, sha256: 'a'.repeat(64),
});

const source = (overrides: Partial<ResearchSource> = {}): ResearchSource => ({
  url: 'https://example.com/a', ok: true, status: 200, contentType: 'text/html', bytes: 1024,
  truncated: false, title: '合成标题', excerpt: '合成摘录', fetchedAt: '2026-10-16T00:00:00.000Z',
  ...overrides,
});

describe('月度理财的 AI 入口装配', () => {
  it('只接受 PNG/JPEG/WebP，其它格式明确拒绝而不是丢图', () => {
    expect(visionMimeFor(document('png'))).toBe('image/png');
    expect(visionMimeFor(document('jpg'))).toBe('image/jpeg');
    expect(visionMimeFor(document('jpeg'))).toBe('image/jpeg');
    expect(visionMimeFor(document('webp'))).toBe('image/webp');
    expect(visionMimeFor(document('bin', 'image/jpeg'))).toBe('image/jpeg');
    expect(visionMimeFor(document('bmp', 'image/bmp'))).toBeNull();
    expect(visionMimeFor(document('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull();
  });

  it('组装视觉请求：base64 内容、可读图任务与“不要推测”的说明', () => {
    const bytes = new Uint8Array([104, 105]);
    const request = buildVisionRequest({
      document: document('jpg'), bytes, profileId: 'profile-1', providerId: 'gateway', requestId: 'req-1',
    });
    expect(request.task).toBe('document-extraction');
    expect(request.input.images).toHaveLength(1);
    expect(request.input.images[0]).toEqual({ mimeType: 'image/jpeg', data: bytesToBase64(bytes) });
    expect(request.input.text).toBe(VISION_INSTRUCTION);
    expect(VISION_INSTRUCTION).toContain('不要推测');
    expect(() => buildVisionRequest({
      document: document('bmp'), bytes, profileId: 'profile-1', providerId: 'gateway', requestId: 'req-2',
    })).toThrow('仅支持 PNG / JPEG / WebP');
  });

  it('解析多行地址：去空行、去重、超上限只取前 5 个并报告丢弃数', () => {
    expect(parseUrlLines('https://a.example/x\n\n  https://b.example/y  \nhttps://a.example/x'))
      .toEqual({ urls: ['https://a.example/x', 'https://b.example/y'], dropped: 0 });
    const many = Array.from({ length: 7 }, (_, index) => `https://e.example/${index}`).join('\n');
    const parsed = parseUrlLines(many);
    expect(parsed.urls).toHaveLength(5);
    expect(parsed.dropped).toBe(2);
    expect(parseUrlLines('   ')).toEqual({ urls: [], dropped: 0 });
  });

  it('检索结果转研究记录：失败或没有摘录的不产出记录', () => {
    const record = researchEvidenceFrom(source(), '2026-10-16T01:00:00.000Z', 0);
    expect(record).toMatchObject({
      id: 'research:2026-10-16T01:00:00.000Z:0', sourceUrl: 'https://example.com/a', publisher: '合成标题',
      retrievedAt: '2026-10-16T00:00:00.000Z', excerpt: '合成摘录', expiryPolicy: 'review-on-change',
    });
    expect(record!.quality).toMatchObject({ source: 'evidence', review: 'pending' });
    expect(researchEvidenceFrom(source({ ok: false, error: 'FETCH_FAILED' }), 'now', 1)).toBeNull();
    expect(researchEvidenceFrom(source({ excerpt: '   ' }), 'now', 2)).toBeNull();
    expect(researchEvidenceFrom(source({ title: null }), 'now', 3)!.publisher).toBe('example.com');
    expect(researchEvidenceFrom(source({ excerpt: 'x'.repeat(3_000) }), 'now', 4)!.excerpt).toHaveLength(2_000);
  });

  it('已有研究记录的来源地址会被收集用于去重', () => {
    const research = [{ sourceUrl: 'https://example.com/a' }, { sourceUrl: 'https://example.com/b' }] as ResearchEvidence[];
    const known = existingResearchUrls(research);
    expect(known.has('https://example.com/a')).toBe(true);
    expect(known.has('https://example.com/c')).toBe(false);
  });
});
