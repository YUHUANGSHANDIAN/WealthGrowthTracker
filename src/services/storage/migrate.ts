/**
 * 数据目录迁移 Domain（v1.6）—— 纯函数路径校验，供 UI / 测试使用。
 * 实际的递归复制由 Rust 命令 migrate_data_root 完成（跨磁盘安全，不依赖 rename）。
 */

export interface DataRootValidation {
  ok: boolean;
  reason?: string;
}

/**
 * 迁移路径规则（v1.6 规则 27）：
 * 禁止：目标为空 / 目标==当前 / 目标在当前内部 / 当前在目标内部。
 */
export function validateDataRootMigration(current: string, target: string): DataRootValidation {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(current.trim());
  const b = norm(target.trim());
  if (!b) return { ok: false, reason: '目标路径为空' };
  if (a && a === b) return { ok: false, reason: '目标目录与当前目录相同' };
  if (a && b.startsWith(a + '/')) return { ok: false, reason: '目标目录不能位于当前目录内部' };
  if (a && a.startsWith(b + '/')) return { ok: false, reason: '当前目录位于目标目录内部，不能作为迁移目标' };
  return { ok: true };
}

export interface StorageMigrationPlan {
  currentRoot: string;
  targetRoot: string;
  /** 迁移后是否需要删除旧根目录（由调用方在验证通过后决定）。 */
  validation: DataRootValidation;
}
