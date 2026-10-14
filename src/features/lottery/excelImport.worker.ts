import * as XLSX from 'xlsx';
import { parseLotteryExcel, type SheetLike } from './excelImport';
import { EXCEL_LIMITS, validateExcelExpansion } from './excelLimits';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    await validateExcelExpansion(event.data);
    const workbook = XLSX.read(event.data, {
      type: 'array', sheetRows: EXCEL_LIMITS.rows + 1, cellFormula: false,
      cellHTML: false, cellStyles: false, bookVBA: false,
    });
    if (workbook.SheetNames.length > EXCEL_LIMITS.sheets) throw new Error('工作表超过 32 个');
    let cells = 0;
    const sheets: SheetLike[] = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name];
      if (!sheet) return { name, rows: [] };
      const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1');
      const rows = range.e.r + 1;
      const columns = range.e.c + 1;
      cells += rows * columns;
      if (rows > EXCEL_LIMITS.rows || columns > EXCEL_LIMITS.columns || cells > EXCEL_LIMITS.cells) {
        throw new Error('工作表行数、列数或单元格总数超过安全限制');
      }
      return { name, rows: XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' }) };
    });
    self.postMessage({ ok: true, preview: parseLotteryExcel(sheets) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : '解析失败' });
  }
};
