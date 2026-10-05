import { describe, it, expect } from 'vitest';
import { parseLotteryExcel, type SheetLike } from '../../src/features/lottery/excelImport';
import { lotteryTxFingerprint, lotteryTxIdFromFingerprint } from '../../src/features/lottery/lotteryTx';

// 完全合成的测试工作簿（不依赖任何真实用户 Excel；验证算法而非真实数据）。
function syntheticSheets(): SheetLike[] {
  return [
    {
      name: '汇总表',
      rows: [
        ['项目', '总收入', '总支出', '净盈利'],
        ['项目A', '0', '300', '-300'],
        ['项目B', '0', '800', '-800'],
        ['项目C', '0', '90', '-90'],
        ['项目D', '120', '100', '20'],
      ],
    },
    {
      name: '项目D 每日统计',
      rows: [['日期', '收入', '支出', '盈利']],
    },
    {
      name: '项目D 交易明细',
      rows: [
        ['交易日期', '交易时间', '收/支/其他', '交易方式', '金额', '转账说明', '交易状态'],
        ['2030-01-01', '10:00', '支出', '支付方式A', '40', '投注', '已收款'],
        ['2030-01-01', '11:00', '收入', '支付方式B', '120', '中奖', '已收款'],
        ['2030-01-02', '09:00', '支出', '支付方式A', '60', '投注', '对方已收款'],
        ['2030-01-02', '10:00', '其他', '支付方式B', '10', '余额调整', '已收款'],
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
    const projA = p.projects.find((x) => x.name === '项目A');
    expect(projA?.dataCompleteness).toBe('summary-only');
    expect(projA?.legacySummary?.expense).toBe(300);
    // 项目A 没有明细交易
    expect(p.transactions.some((t) => t.projectId === projA?.id)).toBe(false);
  });

  it('detailed 项目从交易推导，清除 legacySummary（避免双计数）', () => {
    const p = parseLotteryExcel(syntheticSheets());
    const projD = p.projects.find((x) => x.name === '项目D');
    expect(projD?.dataCompleteness).toBe('detailed');
    expect(projD?.legacySummary).toBeUndefined();
    expect(p.transactions.filter((t) => t.projectId === projD?.id).length).toBe(4);
  });

  it('Legacy 汇总正确（总收入/总支出/净盈亏）', () => {
    const p = parseLotteryExcel(syntheticSheets());
    // 3 summary-only 项目支出 300+800+90=1190；detailed 项目D 收入120 支出100
    expect(p.legacyIncome).toBeCloseTo(120, 2);
    expect(p.legacyExpense).toBeCloseTo(1190 + 100, 2);
  });

  it('交易指纹幂等：重复解析得到相同 id', () => {
    const a = parseLotteryExcel(syntheticSheets());
    const b = parseLotteryExcel(syntheticSheets());
    expect(a.transactions.map((t) => t.id).sort()).toEqual(b.transactions.map((t) => t.id).sort());
  });

  it('指纹基于完整字段', () => {
    const t1 = { occurredAt: '2030-01-01T10:00:00', type: 'stake' as const, amount: 40, paymentMethod: '支付方式A', description: '投注', status: '已收款' };
    const t2 = { ...t1, amount: 41 };
    expect(lotteryTxFingerprint(t1)).not.toBe(lotteryTxFingerprint(t2));
    expect(lotteryTxIdFromFingerprint(lotteryTxFingerprint(t1))).not.toBe(lotteryTxIdFromFingerprint(lotteryTxFingerprint(t2)));
  });
});
