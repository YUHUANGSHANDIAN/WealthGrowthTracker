// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { EXCEL_LIMITS, validateExcelContainer, validateExcelExpansion } from '../../src/features/lottery/excelLimits';

function workbook(type: 'xls' | 'xlsx', compression = false): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['合成项目','金额'],['示例',42]]),'合成');
  return XLSX.write(book,{type:'array',bookType:type,compression}) as ArrayBuffer;
}
function central(buffer: ArrayBuffer): number {
  const view=new DataView(buffer);
  for(let i=0;i<buffer.byteLength-4;i++)if(view.getUint32(i,true)===0x02014b50)return i;
  throw new Error('fixture directory missing');
}
describe('Excel container limits',()=>{
  it('keeps real XLS and XLSX compatibility with synthetic workbooks',async()=>{
    expect(validateExcelContainer(workbook('xls'))).toBe('xls');
    const xlsx=workbook('xlsx');
    expect(validateExcelContainer(xlsx)).toBe('xlsx');
    await expect(validateExcelExpansion(xlsx)).resolves.toBeUndefined();
  });
  it('checks actual decompression before the workbook parser runs',async()=>{
    const compressed = workbook('xlsx',true);
    await expect(validateExcelExpansion(compressed)).resolves.toBeUndefined();
    const view=new DataView(compressed); const offset=central(compressed)+24;
    view.setUint32(offset,view.getUint32(offset,true)-1,true);
    await expect(validateExcelExpansion(compressed)).rejects.toThrow('体积');
  });
  it('rejects large files and unrecognized or truncated containers',()=>{
    expect(()=>validateExcelContainer(new ArrayBuffer(EXCEL_LIMITS.fileBytes+1))).toThrow('20 MB');
    expect(()=>validateExcelContainer(new ArrayBuffer(30))).toThrow('有效');
    const xlsx=workbook('xlsx');
    expect(()=>validateExcelContainer(xlsx.slice(0,xlsx.byteLength-5))).toThrow();
  });
  it('rejects declared ZIP bombs and inconsistent stored entry sizes',async()=>{
    const bomb=workbook('xlsx');
    new DataView(bomb).setUint32(central(bomb)+24,EXCEL_LIMITS.expandedBytes+1,true);
    expect(()=>validateExcelContainer(bomb)).toThrow('安全限制');
    const forged=workbook('xlsx');
    const view=new DataView(forged);const offset=central(forged)+24;
    view.setUint32(offset,view.getUint32(offset,true)-1,true);
    await expect(validateExcelExpansion(forged)).rejects.toThrow('体积不一致');
  });
});
