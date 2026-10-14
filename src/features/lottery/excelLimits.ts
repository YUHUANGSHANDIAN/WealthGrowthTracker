export const EXCEL_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  expandedBytes: 100 * 1024 * 1024,
  entries: 2048,
  sheets: 32,
  rows: 50000,
  columns: 128,
  cells: 500000,
  timeoutMs: 15000,
};

/** Check signatures and ZIP central directory before SheetJS allocates expanded data. */
export function validateExcelContainer(buffer: ArrayBuffer): 'xls' | 'xlsx' {
  if (buffer.byteLength > EXCEL_LIMITS.fileBytes) throw new Error('Excel 文件超过 20 MB');
  const bytes = new Uint8Array(buffer);
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((value, i) => bytes[i] === value)) return 'xls';
  const view = new DataView(buffer);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) throw new Error('不是有效的 XLS 或 XLSX 文件');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP 目录损坏');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      count !== view.getUint16(end + 8, true) || count === 0xffff || offset === 0xffffffff || size === 0xffffffff ||
      count > EXCEL_LIMITS.entries || offset + size !== end) throw new Error('不支持分卷、ZIP64 或过大的 ZIP 目录');
  let position = offset;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error('ZIP 条目损坏');
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const compressed = view.getUint32(position + 20, true);
    const uncompressed = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const local = view.getUint32(position + 42, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if ((flags & 1) || ![0, 8].includes(method) || uncompressed === 0xffffffff ||
        next > end || local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 ||
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + compressed > offset ||
        view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) {
      throw new Error('不支持加密或损坏的 ZIP 条目');
    }
    expanded += uncompressed;
    if (expanded > EXCEL_LIMITS.expandedBytes || uncompressed > Math.max(1024 * 1024, compressed * 200)) {
      throw new Error('ZIP 解压体积或压缩比超过安全限制');
    }
    position = next;
  }
  if (position !== end || count === 0) throw new Error('ZIP 目录数量不一致');
  return 'xlsx';
}

/** Count actual expanded bytes, rejecting dishonest central-directory sizes. */
export async function validateExcelExpansion(buffer: ArrayBuffer): Promise<void> {
  if (validateExcelContainer(buffer) === 'xls') return;
  const view = new DataView(buffer);
  let end = buffer.byteLength - 22;
  while (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== buffer.byteLength) end--;
  let position = view.getUint32(end + 16, true);
  let total = 0;
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    const method = view.getUint16(position + 10, true);
    const compressed = view.getUint32(position + 20, true);
    const expected = view.getUint32(position + 24, true);
    const local = view.getUint32(position + 42, true);
    const payload = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (method === 0) {
      if (compressed !== expected) throw new Error('ZIP 未压缩条目体积不一致');
      total += compressed;
    } else {
      let decoder: DecompressionStream;
      try { decoder = new DecompressionStream('deflate-raw' as CompressionFormat); }
      catch { throw new Error('当前平台不支持安全 ZIP 校验，请更新应用或浏览器'); }
      const reader = new Blob([buffer.slice(payload, payload + compressed)]).stream().pipeThrough(decoder).getReader();
      let actual = 0;
      try {
        let chunk = await reader.read();
        while (!chunk.done) {
          actual += chunk.value.byteLength;
          total += chunk.value.byteLength;
          if (actual > expected || total > EXCEL_LIMITS.expandedBytes) throw new Error('ZIP 实际解压体积超过声明或安全限制');
          chunk = await reader.read();
        }
      } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
      finally { reader.releaseLock(); }
      if (actual !== expected) throw new Error('ZIP 实际解压体积与声明不一致');
    }
    position += 46 + view.getUint16(position + 28, true) + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
}
