import { describe, it, expect } from 'vitest';
import { parseLotteryExcel, type SheetLike } from '../../src/features/lottery/excelImport';
import { lotteryTxFingerprint, lotteryTxIdFromFingerprint } from '../../src/features/lottery/lotteryTx';

// 合成工作簿（模拟真实 Excel 三 Sheet，不依赖真实文件）
function syntheticSheets(): SheetLike[] {
  return [
    {
      name: '汇总表',
      rows: [
        ['项目', '总收入', '总支出', '净盈利'],
        ['20221121-20221218 FIFA2022卡塔尔世界杯', '0', '360', '-360'],
        ['20260612-20260720 FIFA2026美加墨世界杯', '0', '1331.64', '-1331.64'],
        ['2026中国体育彩票超级大乐透', '0', '48', '-48'],
        ['20260721-20300608 竞彩足球', '1259', '1642', '-383'],
      ],
    },
    {
      name: '20260721-20300608 竞彩足球 每日统计',
      rows: [['日期', '收入', '支出', '盈利']],
    },
    {
      name: '20260721-20300608 竞彩足球 交易明细',
      rows: [
        ['交易日期', '交易时间', '收/支/其他', '交易方式', '金额', '转账说明', '交易状态'],
        ['2026-07-21', '10:00', '支出', '零钱通', '20', '投注', '已收款'],
        ['2026-07-21', '11:00', '收入', '零钱', '100', '中奖', '已收款'],
        ['2026-07-22', '09:00', '支出', '浦发银行', '30', '投注', '对方已收款'],
        ['2026-07-22', '10:00', '其他', '零钱通', '5', '余额调整', '已收款'],
      ],
    },
  ];
}

describe('彩票 Excel 导入（合成数据）', () => {
  it('识别三个 Sheet 并生成 4 个项目', () => {
    const p = parseLotteryExcel(syntheticSheets());
    expect(p.projectCount).toBe(4);
    expect(p.detailedTransactionCount).toBe(4);
  });

  it('收入→prize、支出→stake、其他→adjustment', () => {
    const p = parseLotteryExcel(syntheticSheets());
    expect(p.transactions.filter((t) => t.type === 'prize').length).toBe(1);
    expect(p.transactions.filter((t) => t.type === 'stake').length).toBe(2);
    expect(p.transactions.filter((t) => t.type === 'adjustment').length).toBe(1);
  });

  it('summary-only 项目保存 legacySummary，不伪造明细', () => {
    const p = parseLotteryExcel(syntheticSheets());
    const worldCup = p.projects.find((x) => x.name.includes('卡塔尔'));
    expect(worldCup?.dataCompleteness).toBe('summary-only');
    expect(worldCup?.legacySummary?.expense).toBe(360);
    // 卡塔尔项目没有明细交易
    expect(p.transactions.some((t) => t.projectId === worldCup?.id)).toBe(false);
  });

  it('detailed 项目从交易推导，清除 legacySummary（避免双计数）', () => {
    const p = parseLotteryExcel(syntheticSheets());
    const jczq = p.projects.find((x) => x.name.includes('竞彩足球'));
    expect(jczq?.dataCompleteness).toBe('detailed');
    expect(jczq?.legacySummary).toBeUndefined();
    expect(p.transactions.filter((t) => t.projectId === jczq?.id).length).toBe(4);
  });

  it('Legacy 汇总正确（总收入/总支出/净盈亏）', () => {
    const p = parseLotteryExcel(syntheticSheets());
    // 3 summary-only 项目支出 360+1331.64+48=1739.64；detailed 竞彩足球收入100 支出50 净+50
    expect(p.legacyIncome).toBeCloseTo(100, 2);
    expect(p.legacyExpense).toBeCloseTo(1739.64 + 50, 2);
  });

  it('交易指纹幂等：重复解析得到相同 id', () => {
    const a = parseLotteryExcel(syntheticSheets());
    const b = parseLotteryExcel(syntheticSheets());
    expect(a.transactions.map((t) => t.id).sort()).toEqual(b.transactions.map((t) => t.id).sort());
  });

  it('指纹基于完整字段', () => {
    const t1 = { occurredAt: '2026-07-21T10:00:00', type: 'stake' as const, amount: 20, paymentMethod: '零钱通', description: '投注', status: '已收款' };
    const t2 = { ...t1, amount: 21 };
    expect(lotteryTxFingerprint(t1)).not.toBe(lotteryTxFingerprint(t2));
    expect(lotteryTxIdFromFingerprint(lotteryTxFingerprint(t1))).not.toBe(lotteryTxIdFromFingerprint(lotteryTxFingerprint(t2)));
  });
});
