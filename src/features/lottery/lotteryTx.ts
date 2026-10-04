import type { LotteryTransaction } from '../../types';
import { randomId } from '../../utils/id';

/**
 * 彩票交易工具：稳定指纹（Excel 导入幂等去重）+ 新建交易。
 */

/** 基于交易字段生成稳定指纹（用于 Excel 导入幂等：同一 Excel 导入两次不产生重复）。 */
export function lotteryTxFingerprint(t: Pick<LotteryTransaction, 'occurredAt' | 'type' | 'amount' | 'paymentMethod' | 'description' | 'status'>): string {
  return [
    t.occurredAt,
    t.type,
    String(t.amount),
    t.paymentMethod ?? '',
    t.description ?? '',
    t.status ?? '',
  ]
    .join('|')
    .replace(/\|/g, '|');
}

/** 依据指纹生成确定性 id（同一笔交易重复导入得到相同 id）。 */
export function lotteryTxIdFromFingerprint(fp: string): string {
  // 简单散列（FNV-1a 32bit → hex），保证稳定且可复现
  let h = 0x811c9dc5;
  for (let i = 0; i < fp.length; i++) {
    h ^= fp.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `ltx_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** 新建一笔彩票交易。 */
export function makeLotteryTransaction(partial: Partial<LotteryTransaction> & Pick<LotteryTransaction, 'type' | 'amount' | 'occurredAt'>): LotteryTransaction {
  const now = new Date().toISOString();
  const base: LotteryTransaction = {
    id: randomId('ltx'),
    projectId: null,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  if (base.amount < 0) base.amount = Math.abs(base.amount);
  return base;
}
