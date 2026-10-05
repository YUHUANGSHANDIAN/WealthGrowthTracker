import { describe, it, expect } from 'vitest';
import { validateDataRootMigration } from '../../src/services/storage/migrate';

describe('数据目录迁移路径规则', () => {
  it('默认 → 空自定义目录：合法', () => {
    expect(validateDataRootMigration('C:/Users/x/Documents/财富成长记', 'D:/WealthData').ok).toBe(true);
  });

  it('目标 == 当前：非法', () => {
    expect(validateDataRootMigration('D:/WealthData', 'D:/WealthData').ok).toBe(false);
  });

  it('目标为空：非法', () => {
    expect(validateDataRootMigration('D:/WealthData', '   ').ok).toBe(false);
  });

  it('目标在当前目录内部：非法', () => {
    expect(validateDataRootMigration('D:/WealthData', 'D:/WealthData/sub').ok).toBe(false);
  });

  it('当前在目标内部（目标为父目录）：非法', () => {
    expect(validateDataRootMigration('D:/WealthData/sub', 'D:/WealthData').ok).toBe(false);
  });

  it('路径分隔符统一（反斜杠/正斜杠）', () => {
    expect(validateDataRootMigration('D:\\WealthData', 'D:/WealthData/sub').ok).toBe(false);
    expect(validateDataRootMigration('D:\\WealthData', 'E:\\NewData').ok).toBe(true);
  });
});
