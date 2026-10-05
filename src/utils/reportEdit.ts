import type { FinancialReport, ReportFieldProvenance, ReportRepairAudit } from '../types';

/**
 * Advanced Report Editor 的纯函数（v1.6）：
 * - diffReportFields：比较两个报告的字段差异（保存前展示 Diff）。
 * - buildManualEditAudit：生成 manual-report-edit 审计记录（不留痕迹覆盖）。
 */

export interface FieldDiff {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

const COMPARED_FIELDS: { field: keyof FinancialReport; label: string }[] = [
  { field: 'title', label: '标题' },
  { field: 'startDate', label: '开始日期' },
  { field: 'endDate', label: '结束日期' },
  { field: 'dataAsOf', label: '数据截至' },
  { field: 'totalAmount', label: '期末总资产' },
  { field: 'previousTotalAmount', label: '期初总资产' },
  { field: 'changeAmount', label: '变化金额' },
  { field: 'changePercentage', label: '变化率' },
  { field: 'weeklyMax', label: '周最高' },
  { field: 'weeklyMin', label: '周最低' },
  { field: 'weeklyAvg', label: '周平均' },
  { field: 'monthlyMax', label: '月最高' },
  { field: 'monthlyMin', label: '月最低' },
  { field: 'monthlyAvg', label: '月平均' },
  { field: 'yearlyMax', label: '年最高' },
  { field: 'yearlyMin', label: '年最低' },
  { field: 'yearlyAvg', label: '年平均' },
  { field: 'customSummary', label: '摘要' },
  { field: 'archiveNote', label: '归档备注' },
];

/** 比较两个报告的可编辑字段，返回差异列表。 */
export function diffReportFields(original: FinancialReport, edited: FinancialReport): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const { field, label } of COMPARED_FIELDS) {
    const oldValue = original[field];
    const newValue = edited[field];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diffs.push({ field, label, oldValue, newValue });
    }
  }
  // 渠道构成差异（父/子金额）
  if (JSON.stringify(original.channels ?? null) !== JSON.stringify(edited.channels ?? null)) {
    diffs.push({ field: 'channels', label: '渠道构成', oldValue: undefined, newValue: undefined });
  }
  return diffs;
}

/** 生成 manual-report-edit 审计记录。 */
export function buildManualEditAudit(original: FinancialReport, edited: FinancialReport, reason: string): ReportRepairAudit[] {
  const now = new Date().toISOString();
  const source: ReportFieldProvenance = 'manual-repair';
  return diffReportFields(original, edited).map((d) => ({
    field: d.field,
    oldValue: d.oldValue ?? null,
    newValue: d.newValue ?? null,
    reason: reason.trim() || '手动编辑报告',
    source,
    repairedAt: now,
  }));
}
