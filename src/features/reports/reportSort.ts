import type { FinancialReport } from '../../types';
import { getLevelByAmount, getLevelIndex } from '../../constants/levels';

/**
 * 报告多维排序（强类型字段，不复用渠道的 string field comparator）。
 * N/A（缺失）字段始终排到末尾，与升/降序无关。
 */

export type ReportSortField =
  | 'period'
  | 'createdAt'
  | 'totalAmount'
  | 'changeAmount'
  | 'changePercentage'
  | 'periodMax'
  | 'periodMin'
  | 'periodAvg'
  | 'wealthLevel'
  | 'completeness'
  | 'reportType'
  | 'archived';

export type SortDirection = 'asc' | 'desc';

export interface ReportSortRule {
  field: ReportSortField;
  direction: SortDirection;
}

export type ReportSortSpec = ReportSortRule[];

export const REPORT_SORT_FIELDS: { field: ReportSortField; label: string }[] = [
  { field: 'period', label: '周期' },
  { field: 'createdAt', label: '生成时间' },
  { field: 'totalAmount', label: '期末资产' },
  { field: 'changeAmount', label: '变化金额' },
  { field: 'changePercentage', label: '变化率' },
  { field: 'periodMax', label: '期间最高' },
  { field: 'periodMin', label: '期间最低' },
  { field: 'periodAvg', label: '期间平均' },
  { field: 'wealthLevel', label: '财富等级' },
  { field: 'completeness', label: '数据完整度' },
  { field: 'reportType', label: '报告类型' },
  { field: 'archived', label: '归档状态' },
];

function extremaOf(report: FinancialReport): { max?: number; min?: number; avg?: number } {
  switch (report.reportType) {
    case 'weekly':
      return { max: report.weeklyMax, min: report.weeklyMin, avg: report.weeklyAvg };
    case 'monthly':
      return { max: report.monthlyMax, min: report.monthlyMin, avg: report.monthlyAvg };
    case 'yearly':
      return { max: report.yearlyMax, min: report.yearlyMin, avg: report.yearlyAvg };
  }
}

const REPORT_TYPE_ORDER: Record<FinancialReport['reportType'], number> = {
  weekly: 0,
  monthly: 1,
  yearly: 2,
};

/** 提取某报告某排序字段的值（number | string；缺失返回 null 表示 N/A）。 */
export function reportFieldValue(report: FinancialReport, field: ReportSortField): number | string | null {
  switch (field) {
    case 'period':
      return report.startDate || report.endDate || null;
    case 'createdAt':
      return report.createdAt ? new Date(report.createdAt).getTime() : null;
    case 'totalAmount':
      return Number.isFinite(report.totalAmount) ? report.totalAmount : null;
    case 'changeAmount':
      return Number.isFinite(report.changeAmount) ? report.changeAmount : null;
    case 'changePercentage':
      return Number.isFinite(report.changePercentage) ? report.changePercentage : null;
    case 'periodMax':
      return extremaOf(report).max ?? null;
    case 'periodMin':
      return extremaOf(report).min ?? null;
    case 'periodAvg':
      return extremaOf(report).avg ?? null;
    case 'wealthLevel':
      return getLevelIndex(getLevelByAmount(report.totalAmount));
    case 'completeness':
      return report.dataCompleteness ?? null;
    case 'reportType':
      return REPORT_TYPE_ORDER[report.reportType];
    case 'archived':
      return report.isArchived ? 1 : 0;
  }
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** 按多维排序规则对报告数组做稳定排序（纯函数，不改原数组）。N/A 始终排最后。 */
export function sortReports(reports: FinancialReport[], spec: ReportSortSpec): FinancialReport[] {
  if (spec.length === 0) return [...reports];
  const indexed = reports.map((r, i) => ({ r, i }));
  indexed.sort((x, y) => {
    for (const rule of spec) {
      const va = reportFieldValue(x.r, rule.field);
      const vb = reportFieldValue(y.r, rule.field);
      // N/A 处理与方向无关：缺失值始终排到最后
      if (va === null || vb === null) {
        if (va === null && vb === null) continue;
        return va === null ? 1 : -1;
      }
      const d = compareValues(va, vb);
      if (d !== 0) return rule.direction === 'asc' ? d : -d;
    }
    return x.i - y.i; // 稳定排序
  });
  return indexed.map((x) => x.r);
}

export interface ReportSortPreset {
  id: string;
  label: string;
  description: string;
  spec: ReportSortSpec;
}

/** 报告排序预设（信息管理排序，非投资建议）。 */
export const REPORT_SORT_PRESETS: ReportSortPreset[] = [
  { id: 'recent', label: '最近报告', description: '周期从新到旧', spec: [{ field: 'period', direction: 'desc' }] },
  { id: 'significant', label: '变化显著', description: '变化金额从大到小', spec: [{ field: 'changeAmount', direction: 'desc' }] },
  { id: 'asset-size', label: '资产规模', description: '期末资产从大到小', spec: [{ field: 'totalAmount', direction: 'desc' }] },
  { id: 'most-complete', label: '数据最完整', description: '数据完整度从高到低', spec: [{ field: 'completeness', direction: 'desc' }] },
  { id: 'unarchived-first', label: '未归档优先', description: '未归档在前，按周期新到旧', spec: [{ field: 'archived', direction: 'asc' }, { field: 'period', direction: 'desc' }] },
  { id: 'archive-mgmt', label: '归档管理', description: '已归档在前，按周期新到旧', spec: [{ field: 'archived', direction: 'desc' }, { field: 'period', direction: 'desc' }] },
];

export const DEFAULT_REPORT_SORT: ReportSortSpec = [{ field: 'period', direction: 'desc' }];
