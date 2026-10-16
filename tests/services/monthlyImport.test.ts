import { beforeEach, describe, expect, it } from 'vitest';
import { writeZip } from '../../src/services/documents/zip';
import { EXTRACTED_HOLDING_PREFIX, importDocuments, rebuildCandidatesFromDocuments } from '../../src/services/monthlyPlanning/importDocuments';
import { createDraftSession } from '../../src/domain/portfolio/session';
import type { MonthlyReview } from '../../src/domain/portfolio/types';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...texts: string[]) => `<w:tr>${texts.map(cell).join('')}</w:tr>`;
const docx = (body: string): Uint8Array => writeZip([{
  name: 'word/document.xml',
  data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
}]);

/** 微信导出的真实表头形状：序号在前，份额在市值之前。 */
const wechatDocx = (): Uint8Array => docx(
  `<w:tbl>${row('序号NO.', '基金名称Fund name', '基金代码Fund code', '查询份额Fund shares', '查询市值(元)Market value(CNY)')}`
  + `${row('01', '华泰柏瑞鼎利混合C', '004011', '1,234.56', '8,000.00')}`
  + `${row('02', '国泰黄金ETF联接C', '004253', '500.00', '1,200.00')}</w:tbl>`,
);

/** jsdom 的 File 没有 arrayBuffer()，这里用结构相同的对象（真实 WebView 两者都有）。 */
interface FileLikeInput { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }
const fileOf = (bytes: Uint8Array, name: string, type = ''): FileLikeInput => ({
  name, type, arrayBuffer: async () => bytes.slice().buffer,
});
const docxFile = (name = '20260720微信渠道.docx'): FileLikeInput =>
  fileOf(wechatDocx(), name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
const textFile = (name = '指令/用户输入信息.md'): FileLikeInput => fileOf(new TextEncoder().encode('全部持有 · 共 209 条'), name, 'text/markdown');

const session = (overrides: Partial<MonthlyReview> = {}): MonthlyReview => ({
  ...createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-20', now: 'now' }),
  ...overrides,
});

describe('资料导入（可观察、不静默跳过）', () => {
  beforeEach(() => localStorage.clear());

  it('选了归属渠道：解析出候选并建立持仓与观察', async () => {
    const result = await importDocuments({ session: session(), files: [docxFile()], channelId: 'channel-1', now: 'now' });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ status: 'imported', candidates: 2, createdFacts: true });
    expect(result.session.documents).toHaveLength(1);
    expect(result.session.holdings).toHaveLength(2);
    expect(result.session.holdings.every((holding) => holding.id.startsWith(EXTRACTED_HOLDING_PREFIX))).toBe(true);
    expect(result.session.holdings.every((holding) => holding.parentChannelId === 'channel-1')).toBe(true);
    expect(result.session.holdings.map((holding) => holding.fundCode)).toEqual(['004011', '004253']);
    const first = result.session.observations[0]!;
    expect(first.marketValue).toBe(8000);
    expect(first.shares).toBe('1234.56');
    expect(first.quality.attribution).toBe('conditional');
  });

  it('没选归属渠道：资料入库、候选照常统计，但不硬塞进某个渠道', async () => {
    const result = await importDocuments({ session: session(), files: [docxFile()], channelId: null, now: 'now' });
    expect(result.outcomes[0]).toMatchObject({ status: 'imported', candidates: 2, createdFacts: false });
    expect(result.outcomes[0]!.note).toContain('未选择归属渠道');
    expect(result.session.documents).toHaveLength(1);
    expect(result.session.holdings).toHaveLength(0);
    expect(result.session.observations).toHaveLength(0);
  });

  it('说明类资料只留档、不产生持仓，并且每份文件都有结果', async () => {
    const result = await importDocuments({
      session: session(), files: [docxFile(), textFile(), fileOf(new Uint8Array([1, 2, 3]), 'x.exe')],
      channelId: 'channel-1', now: 'now',
    });
    expect(result.outcomes).toHaveLength(3);
    const [docxOutcome, textOutcome, badOutcome] = result.outcomes;
    expect(textOutcome).toMatchObject({ status: 'imported' });
    expect(textOutcome!.note).toContain('不产生持仓');
    expect(badOutcome).toMatchObject({ status: 'failed' });
    expect(badOutcome!.error).toContain('不支持');
    expect(docxOutcome!.status).toBe('imported');
    expect(result.session.holdings).toHaveLength(2);
  });

  it('重复导入同一文件不重复入库，但在选了渠道时会补齐缺失的候选', async () => {
    const noChannel = await importDocuments({ session: session(), files: [docxFile()], channelId: null, now: 'now' });
    expect(noChannel.session.holdings).toHaveLength(0);

    const again = await importDocuments({ session: noChannel.session, files: [docxFile()], channelId: 'channel-1', now: 'now' });
    expect(again.outcomes[0]).toMatchObject({ status: 'duplicate', candidates: 2, createdFacts: true });
    expect(again.outcomes[0]!.note).toContain('未重复入库');
    expect(again.session.documents).toHaveLength(1);
    expect(again.session.holdings).toHaveLength(2);

    const third = await importDocuments({ session: again.session, files: [docxFile()], channelId: 'channel-1', now: 'now' });
    expect(third.session.holdings).toHaveLength(2);
    expect(third.outcomes[0]!.note).toContain('候选已存在');
  });
});

describe('从已入库资料生成候选', () => {
  beforeEach(() => localStorage.clear());

  it('补齐缺失候选且重复执行幂等', async () => {
    const imported = await importDocuments({ session: session(), files: [docxFile()], channelId: null, now: 'now' });
    expect(imported.session.holdings).toHaveLength(0);

    const first = await rebuildCandidatesFromDocuments({ session: imported.session, channelId: 'channel-1', now: 'now' });
    expect(first).toMatchObject({ created: 2, scanned: 1 });
    expect(first.session.holdings).toHaveLength(2);
    expect(first.session.observations).toHaveLength(2);

    const second = await rebuildCandidatesFromDocuments({ session: first.session, channelId: 'channel-1', now: 'now' });
    expect(second).toMatchObject({ created: 0, scanned: 0 });
    expect(second.session.holdings).toHaveLength(2);
  });
});
