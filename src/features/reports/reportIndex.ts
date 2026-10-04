import type { FinancialReport } from '../../types';
import { reportFileBase, reportHtml } from './reportFile';

/**
 * 报告文件索引（reports/index.json）与 CSV 索引导出。
 * 仅用于维护/索引，不作为第二数据库——App State 仍是 canonical。
 */

export interface ReportIndexEntry {
  reportId: string;
  periodKey: string;
  type: FinancialReport['reportType'];
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  relativePath: string;
  schemaVersion: number;
}

/** 单份报告的索引条目（供 reports/index.json）。 */
export function reportIndexEntry(report: FinancialReport): ReportIndexEntry {
  const rel = `${report.reportType}/${reportFileBase(report)}.json`;
  return {
    reportId: report.id,
    periodKey: report.periodKey ?? '',
    type: report.reportType,
    title: report.title,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt ?? report.createdAt,
    revision: report.revision ?? 1,
    relativePath: rel,
    schemaVersion: report.reportSchemaVersion ?? 2,
  };
}

/** reports/index.json 内容（多份报告）。 */
export function buildReportIndex(reports: FinancialReport[]): { version: number; generatedAt: string; reports: ReportIndexEntry[] } {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    reports: reports.map(reportIndexEntry),
  };
}

/** CSV 索引（报告列表导出）。 */
export function buildReportsIndexCsv(reports: FinancialReport[]): { header: string[]; rows: (string | number)[][] } {
  const header = ['reportId', 'periodKey', 'type', 'title', 'createdAt', 'updatedAt', 'revision', 'relativePath', 'schemaVersion'];
  const rows = reports.map((r) => {
    const e = reportIndexEntry(r);
    return [e.reportId, e.periodKey, e.type, e.title, e.createdAt, e.updatedAt, e.revision, e.relativePath, e.schemaVersion];
  });
  return { header, rows };
}

/** 批量 HTML 合集（多份报告拼在一个可打印 HTML 中，用于「批量 HTML」导出）。 */
export function buildReportsBatchHtml(reports: FinancialReport[]): string {
  const sections = reports.map((r) => {
    const body = reportHtml(r);
    // 去掉 <html>/<head>，只保留 body 内容，拼入合集
    const inner = body.replace(/[\s\S]*?<body>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    return `<section class="report">${inner}</section>`;
  });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>财务报告合集</title>
<style>
body{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#0f172a;}
.report{border:1px solid #e2e8f0;border-radius:14px;padding:20px;margin-bottom:24px;}
</style></head><body>
<h1 style="font-size:22px">财务报告合集（${reports.length} 份）</h1>
<p style="color:#64748b;font-size:13px">由「财富成长记」导出 · ${new Date().toLocaleString('zh-CN')}</p>
${sections.join('\n')}
</body></html>`;
}
