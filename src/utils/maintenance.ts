import type { Channel, FinancialReport, HistoryPoint } from '../types';
import { checkReportHealth } from './dataHealth';
import { duplicateHistoryDates } from './history';
import { reportCoverage } from '../features/reports/backfill';

/**
 * Maintenance Action Engine（v1.6）—— 动态生成当前「还需要处理什么」，
 * 完成后重新扫描，Issue 不存在则 Action 自动消失（普适，不写死用户特定状态）。
 */

export interface MaintenanceAction {
  id: string;
  title: string;
  description: string;
  category: 'reports' | 'history' | 'storage' | 'backup';
  severity: 'info' | 'warning' | 'error';
}

export interface MaintenanceInput {
  reports: FinancialReport[];
  history: HistoryPoint[];
  channels: Channel[];
  hasCustomStorage?: boolean;
}

export function buildMaintenanceActions(input: MaintenanceInput): MaintenanceAction[] {
  const actions: MaintenanceAction[] = [];
  const reportIssues = checkReportHealth(input.reports);
  const dupHistory = duplicateHistoryDates(input.history);

  // 周报 ISO 周期错误
  const isoErrors = reportIssues.filter((i) =>
    i.title.includes('周期') || i.title.includes('isoWeek') || i.title.includes('weekNumber') || i.title.includes('标准标题'),
  );
  if (isoErrors.length > 0) {
    actions.push({
      id: 'iso-repair',
      title: '修复周报 ISO 周期',
      description: `${isoErrors.length} 份周报的周期元数据与 ISO 8601 不一致`,
      category: 'reports',
      severity: 'warning',
    });
  }

  // 重复报告周期
  const dupPeriod = reportIssues.filter((i) => i.title.includes('重复周期'));
  if (dupPeriod.length > 0) {
    actions.push({
      id: 'dup-period',
      title: '处理重复报告周期',
      description: `${dupPeriod.length} 个周期存在多份报告`,
      category: 'reports',
      severity: 'error',
    });
  }

  // 重复历史日期
  if (dupHistory.length > 0) {
    actions.push({
      id: 'dup-history',
      title: '处理重复历史日期',
      description: `${dupHistory.length} 个日期存在多条历史记录`,
      category: 'history',
      severity: 'error',
    });
  }

  // 缺失月报
  const coverage = reportCoverage(input.reports, input.history);
  const missing = coverage.filter((c) => c.lastDataDate && !c.hasReport);
  if (missing.length > 0) {
    actions.push({
      id: 'missing-monthly',
      title: '补全缺失月报',
      description: `${missing.length} 个历史月份缺月度报告`,
      category: 'reports',
      severity: 'info',
    });
  }

  return actions;
}
