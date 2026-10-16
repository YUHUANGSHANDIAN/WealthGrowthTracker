import { describe, expect, it } from 'vitest';
import { ZipArchive, ZipError, assertSafeEntryName, crc32, writeZip } from '../../src/services/documents/zip';
import { extractDocx, extractDocxFromPackage } from '../../src/services/documents/ooxml';
import {
  MAX_SOURCE_BYTES, assertIntakeAllowed, classifyDocument, detectPlatform, intakeDocument, privateRelativePath, sha256Hex,
} from '../../src/services/documents/intake';
import { assertDirectFundScope, detectScopeHints, planImageChunks } from '../../src/services/documents/image';
import { extractHoldingRows, parseMoneyText, parseSharesText, summarizeCandidates } from '../../src/services/documents/holdings';
import type { SourceDocument } from '../../src/domain/portfolio/types';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS = `xmlns:w="${W}" xmlns:mc="${MC}" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`;

const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...texts: string[]) => `<w:tr>${texts.map(cell).join('')}</w:tr>`;
const holdingsTable = (codeRows: Array<[string, string, string]>) =>
  `<w:tbl>${row('基金代码', '产品名称', '市值')}${codeRows.map(([code, name, value]) => row(code, name, value)).join('')}</w:tbl>`;

const documentXml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;

const chooseWps = `<mc:AlternateContent><mc:Choice Requires="wps"><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${holdingsTable([['110011', '易方达优质精选', '8,000.00']])}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${holdingsTable([['110011', '易方达优质精选', '8,000.00']])}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p></mc:Fallback></mc:AlternateContent>`;
const chooseUnsupported = `<mc:AlternateContent><mc:Choice Requires="unsupported-ns"><w:p><w:r><w:t>不支持的表示</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>回退表示</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>`;

function docxBytes(body: string): Uint8Array {
  return writeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: documentXml(body) },
  ]);
}

/** 手工构造最小 ZIP（用于越界/炸弹用例，writeZip 会主动拒绝不安全输入）。 */
function rawZip(entries: Array<{ name: string; declared: number; dataLength?: number }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const dataLength = entry.dataLength ?? 0;
    const nameBytes = encoder.encode(entry.name);
    const local = new Uint8Array(30 + nameBytes.length + dataLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, entry.declared, true);
    localView.setUint32(22, entry.declared, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, 0, true);
    centralView.setUint32(20, dataLength, true);
    centralView.setUint32(24, entry.declared, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((total, chunk) => total + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  const all = [...locals, ...centrals, eocd];
  const out = new Uint8Array(all.reduce((total, chunk) => total + chunk.length, 0));
  let cursor = 0;
  for (const chunk of all) { out.set(chunk, cursor); cursor += chunk.length; }
  return out;
}

describe('D01–D03 DOCX 解析', () => {
  it('D01 正文表格与文本框都能读取，且带表格/行/列定位', () => {
    const extraction = extractDocx(documentXml(`<w:p><w:r><w:t>支付宝持仓</w:t></w:r></w:p>${holdingsTable([['000001', '华夏成长', '1,234.56']])}${chooseWps}`));
    expect(extraction.paragraphs).toContain('支付宝持仓');
    const bodyTables = extraction.tables.filter((table) => table.source === 'body');
    const textboxTables = extraction.tables.filter((table) => table.source === 'textbox');
    expect(bodyTables).toHaveLength(1);
    expect(textboxTables).toHaveLength(1);
    const rowCells = bodyTables[0]!.rows[1]!.cells;
    expect(rowCells.map((c) => c.text)).toEqual(['000001', '华夏成长', '1,234.56']);
    expect(rowCells[0]!.cellIndex).toBe(0);
  });
  it('D02 mc:AlternateContent 只读一种表示，不双计', () => {
    const extraction = extractDocx(documentXml(chooseWps));
    expect(extraction.tables).toHaveLength(1);
    expect(extraction.alternates).toHaveLength(1);
    expect(extraction.alternates[0]!.chosen).toBe('choice');
    const fallbackOnly = extractDocx(documentXml(chooseUnsupported));
    expect(fallbackOnly.alternates[0]!.chosen).toBe('fallback');
    expect(fallbackOnly.paragraphs.join()).toContain('回退表示');
    expect(fallbackOnly.paragraphs.join()).not.toContain('不支持的表示');
  });
  it('D03 重复表头、合并单元格与前导零代码', () => {
    const merged = `<w:tbl>${row('基金代码', '产品名称', '市值')}<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>华夏成长</w:t></w:r></w:p></w:tc>${cell('1,000.00')}</w:tr>${row('基金代码', '产品名称', '市值')}${row('000001', '华夏成长', '1,234.56')}</w:tbl>`;
    const [table] = extractDocx(documentXml(merged)).tables;
    expect(table!.rows[0]!.isHeader).toBe(true);
    expect(table!.rows[2]!.isHeader).toBe(true);
    expect(table!.rows[1]!.cells[0]!.gridSpan).toBe(2);
    expect(table!.warnings.join()).toContain('合并单元格');
    expect(table!.rows[3]!.cells[0]!.text).toBe('000001');
    const extraction = extractDocx(documentXml(merged));
    const { rows, duplicates } = extractHoldingRows(extraction.tables, { sourceId: 'doc-1', extractor: 'ooxml', extractorVersion: '1' });
    expect(rows.map((row) => row.fundCode)).toEqual(['000001']);
    expect(duplicates).toBe(0);
  });
  it('D05 拒绝不安全条目与压缩炸弹，解析失败不产生半成品', () => {
    expect(() => assertSafeEntryName('../evil.txt')).toThrow(ZipError);
    expect(() => assertSafeEntryName('C:\\temp\\evil.txt')).toThrow();
    expect(() => ZipArchive.open(rawZip([{ name: '../evil.txt', declared: 10, dataLength: 10 }]))).toThrow('上级跳转');
    expect(() => ZipArchive.open(rawZip([{ name: 'word/document.xml', declared: 200 * 1024 * 1024 }]))).toThrow('条目过大');
    const bomb = rawZip([
      { name: 'a.bin', declared: 60 * 1024 * 1024 },
      { name: 'b.bin', declared: 60 * 1024 * 1024 },
      { name: 'c.bin', declared: 60 * 1024 * 1024 },
    ]);
    expect(() => ZipArchive.open(bomb)).toThrow('压缩炸弹');
    const tooMany = writeZip(Array.from({ length: 3 }, (_, index) => ({ name: `f${index}.txt`, data: 'x' })));
    expect(() => ZipArchive.open(tooMany, { maxEntries: 1, maxEntryBytes: 1_000, maxTotalBytes: 10_000 })).toThrow('条目过多');
    expect(() => extractDocx('<not-xml')).toThrow();
  });
  it('DOCX 包读取端到端可用，且缺正文时报错', async () => {
    const extraction = await extractDocxFromPackage(docxBytes(holdingsTable([['000001', '华夏成长', '1,234.56']])));
    expect(extraction.tables).toHaveLength(1);
    await expect(extractDocxFromPackage(writeZip([{ name: 'word/other.xml', data: '<x/>' }]))).rejects.toThrow('word/document.xml');
  });
  it('ZIP 写入的 CRC 与读取一致', () => {
    const data = new TextEncoder().encode('hello');
    expect(crc32(data)).toBe(0x3610a686);
  });
});

describe('D06 文件入库与幂等', () => {
  const existing: SourceDocument[] = [{
    id: 'doc-1', relativePath: 'monthly-planning/ab/abc.docx', sha256: 'b'.repeat(64), originalName: '微信渠道.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', platform: 'wechat',
    importedAt: '2026-07-20T00:00:00.000Z', integrity: 'ok', parseState: 'parsed',
  }];
  it('按哈希去重，不重复建立文档', () => {
    const result = intakeDocument({ id: 'doc-2', name: '微信渠道.docx', mime: '', byteLength: 100, hash: 'b'.repeat(64), importedAt: 'now' }, existing);
    expect(result.duplicateOf).toBe('doc-1');
    expect(result.document.id).toBe('doc-1');
  });
  it('拒绝超大与不支持类型，路径按哈希分桶且不含绝对路径', () => {
    expect(() => assertIntakeAllowed('x.docx', MAX_SOURCE_BYTES + 1)).toThrow('上限');
    expect(() => assertIntakeAllowed('x.exe', 10)).toThrow('不支持');
    expect(classifyDocument('a.PNG')).toBe('image');
    expect(classifyDocument('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    const path = privateRelativePath('c'.repeat(64), '支付宝渠道.docx');
    expect(path).toBe(`monthly-planning/cc/${'c'.repeat(64)}.docx`);
    expect(detectPlatform('京东白条.docx')).toBe('jd');
    expect(detectPlatform('手工录入')).toBe('manual');
  });
  it('哈希稳定且为小写十六进制', async () => {
    const hash = await sha256Hex(new TextEncoder().encode('abc'));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('D04 长图分块与范围声明', () => {
  it('分块覆盖整图并保留重叠关系，不缩小整图', () => {
    const chunks = planImageChunks({ width: 1_316, height: 5_000, chunkHeight: 2_000, overlap: 200 });
    expect(chunks[0]!.box.y).toBe(0);
    expect(chunks[1]!.box.y).toBe(1_800);
    expect(chunks[1]!.overlaps).toEqual([0]);
    const last = chunks[chunks.length - 1]!;
    expect(last.box.y + last.box.height).toBe(5_000);
    expect(() => planImageChunks({ width: 10, height: 10, chunkHeight: 100, overlap: 60 })).toThrow();
    expect(() => planImageChunks({ width: 0, height: 10 })).toThrow();
  });
  it('“全部持有”与筛选提示会阻止 D−S 推定', () => {
    const hints = detectScopeHints('全部持有 · 共 209 条 · 筛选');
    expect(hints.allHoldings).toBe(true);
    expect(hints.filtered).toBe(true);
    expect(hints.notes.join()).toContain('全部持有');
    expect(assertDirectFundScope({ directFundList: true, allHoldings: true, filtered: false, complete: true })).toMatchObject({ allowed: false });
    expect(assertDirectFundScope({ directFundList: true, allHoldings: false, filtered: true, complete: true }).reason).toContain('筛选');
    expect(assertDirectFundScope({ directFundList: false, allHoldings: false, filtered: false, complete: true }).reason).toContain('直接基金');
    expect(assertDirectFundScope({ directFundList: true, allHoldings: false, filtered: false, complete: true }).allowed).toBe(true);
  });
});

describe('结构化持仓候选', () => {
  it('金额/份额解析失败记为未知而不是 0', () => {
    expect(parseMoneyText('1,234.56')).toBe(1234.56);
    expect(parseMoneyText('(1,234.56)')).toBe(-1234.56);
    expect(parseMoneyText('¥ 8,000')).toBe(8000);
    expect(parseMoneyText('待确认')).toBeNull();
    expect(parseSharesText('1,200.50份')).toBe('1200.50');
    expect(parseSharesText('--')).toBeNull();
  });
  it('从表格行生成候选并汇总可确认/未知/异常', () => {
    const extraction = extractDocx(documentXml(holdingsTable([
      ['000001', '华夏成长', '1,234.56'],
      ['110011', '易方达优质精选', '待确认'],
    ])));
    const { rows, duplicates } = extractHoldingRows(extraction.tables, { sourceId: 'doc-1', extractor: 'ooxml', extractorVersion: '1' });
    expect(rows).toHaveLength(2);
    expect(duplicates).toBe(0);
    expect(rows[0]!.fundCode).toBe('000001');
    expect(rows[0]!.marketValue).toBe(1234.56);
    expect(rows[1]!.marketValue).toBeNull();
    const summary = summarizeCandidates(rows);
    expect(summary.total).toBe(2);
    expect(summary.confirmable).toBe(1);
    expect(summary.unknownValue).toBe(1);
    expect(rows[0]!.evidence[0]!.tableIndex).toBe(0);
    expect(rows[0]!.evidence[0]!.rowIndex).toBe(1);
  });
  it('同一表格内完全相同的行按重复计数，不产生第二条候选', () => {
    const duplicateTable = `<w:tbl>${row('基金代码', '产品名称', '市值')}${row('000001', '华夏成长', '1,234.56')}${row('000001', '华夏成长', '1,234.56')}</w:tbl>`;
    const extraction = extractDocx(documentXml(duplicateTable));
    const { rows, duplicates } = extractHoldingRows(extraction.tables, { sourceId: 'doc-1', extractor: 'ooxml', extractorVersion: '1' });
    expect(rows).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe('真实导出表头形状的列映射', () => {
  const extract = (body: string) =>
    extractHoldingRows(extractDocx(documentXml(body)).tables, { sourceId: 'doc-real', extractor: 'ooxml', extractorVersion: '1' });

  it('微信：序号被忽略，查询份额进 shares、查询市值进 marketValue', () => {
    const wechat = `<w:tbl>${row('序号NO.', '基金名称Fund name', '基金代码Fund code', '查询份额Fund shares', '查询市值(元)Market value(CNY)')}${row('01', '华泰柏瑞鼎利混合C', '004011', '1,234.56', '8,000.00')}</w:tbl>`;
    const { rows, columnMap, tableIssues } = extract(wechat);
    expect(columnMap).toMatchObject({ fundCode: 2, name: 1, shares: 3, marketValue: 4 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fundCode).toBe('004011');
    expect(rows[0]!.name).toBe('华泰柏瑞鼎利混合C');
    // 回归：修复前这两列被取反（序号被当成市值）。
    expect(rows[0]!.shares).toBe('1234.56');
    expect(rows[0]!.marketValue).toBe(8000);
    expect(rows[0]!.issues).toEqual([]);
    expect(tableIssues).toEqual([]);
  });

  it('支付宝：交易账号与序号被忽略，净值日期不被当成净值，分页续表的行沿用同一映射', () => {
    const alipay = `<w:tbl>${row('序号', '基金交易账号', '基金名称', '基金代码', '总份额', '单位净值', '单位净值日期', '资产小计')}${row('1', '1234567890', '华安乾煜债券A(鑫选目标盈)', '013650', '1,000.50', '1.2340', '20260720', '1,234.56')}</w:tbl>`
      + `<w:tbl>${row('2', '1234567890', '鹏华丰享债券', '004388', '2,000.00', '1.5000', '2026-07-20', '3,000.00')}</w:tbl>`;
    const { rows, columnMap } = extract(alipay);
    expect(columnMap).toMatchObject({ fundCode: 3, name: 2, shares: 4, nav: 5, navDate: 6, marketValue: 7 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toMatchObject({ fundCode: '013650', shares: '1000.50', nav: '1.2340', navDate: '2026-07-20', marketValue: 1234.56 });
    expect(rows[1]!).toMatchObject({ fundCode: '004388', shares: '2000.00', nav: '1.5000', navDate: '2026-07-20', marketValue: 3000 });
    expect(rows[0]!.issues).toEqual([]);
  });

  it('没有表头时退回位置推定，但必须带问题提示', () => {
    const headerless = `<w:tbl>${row('000001', '华夏成长', '1,234.56')}</w:tbl>`;
    const { rows, columnMap, tableIssues } = extract(headerless);
    expect(columnMap).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.marketValue).toBe(1234.56);
    expect(tableIssues.join()).toContain('未识别表头');
  });

  it('同一列命中多个关键字时忽略该列并提示', () => {
    const ambiguous = `<w:tbl>${row('基金代码', '产品名称', '份额净值', '市值')}${row('000001', '华夏成长', '1,200.00', '1,234.56')}</w:tbl>`;
    const { tableIssues } = extract(ambiguous);
    expect(tableIssues.join()).toContain('同时匹配');
  });

  it('有净值却读不到净值日期时不写净值，避免用当天日期冒充', () => {
    const noDate = `<w:tbl>${row('基金代码', '基金名称', '总份额', '单位净值', '资产小计')}${row('013650', '华安乾煜债券A', '1,000.50', '1.2340', '1,234.56')}</w:tbl>`;
    const { rows } = extract(noDate);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nav).toBeNull();
    expect(rows[0]!.navDate).toBeNull();
    expect(rows[0]!.issues.join()).toContain('缺少净值日期');
    expect(rows[0]!.marketValue).toBe(1234.56);
  });
});
