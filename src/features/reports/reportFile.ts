import type { FinancialReport } from '../../types';
import { formatCNY } from '../../utils/money';

/** 报告文件基础名（ASCII，便于 CI / 文件系统），如 2026-W40-weekly-report。 */
export function reportFileBase(report: FinancialReport): string {
  // 优先用统一 periodKey（v1.3），保证标题/文件名/排序/去重同源。
  if (report.periodKey) {
    const key = report.periodKey.replace(':', '-');
    return `${key}-${report.reportType}-report`;
  }
  const y = report.year ?? new Date(report.createdAt).getFullYear();
  switch (report.reportType) {
    case 'weekly':
      return `${y}-W${String(report.weekNumber ?? 0).padStart(2, '0')}-weekly-report`;
    case 'monthly':
      return `${y}-${String(report.monthNumber ?? 0).padStart(2, '0')}-monthly-report`;
    case 'yearly':
      return `${y}-yearly-report`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 生成可直接用浏览器打开并打印为 PDF 的自包含 HTML 报告。 */
export function reportHtml(report: FinancialReport): string {
  const positive = report.changeAmount >= 0;
  const pct = Math.abs(report.changePercentage);
  const comp = report.assetComposition;

  // 层级资产构成（父渠道粗体 + 子渠道缩进）；无层级时回退扁平叶子列表。
  let rows = '';
  if (comp && comp.parents.length > 0) {
    rows = comp.parents
      .map((p) => {
        const parentRow = `<tr class="parent"><td><b>${esc(p.emoji ?? '')} ${esc(p.name)}</b></td><td class="num">${formatCNY(p.amount)}</td><td class="num">${p.percentageOfTotal.toFixed(1)}%</td><td class="num">—</td></tr>`;
        const childRows = p.children
          .map(
            (c) => `<tr><td class="child">└ ${esc(c.emoji ?? '')} ${esc(c.name)}</td><td class="num">${formatCNY(c.amount)}</td><td class="num">${c.percentageOfTotal.toFixed(1)}%</td><td class="num">${c.percentageOfParent.toFixed(1)}%</td></tr>`,
          )
          .join('');
        return parentRow + childRows;
      })
      .join('');
  } else {
    rows = [...report.channelDetails]
      .sort((a, b) => b.amount - a.amount)
      .map(
        (c) => `<tr><td>${esc(c.emoji ?? '')} ${esc(c.name)}</td><td class="num">${formatCNY(c.amount)}</td><td class="num">${c.percentage.toFixed(1)}%</td><td class="num">—</td></tr>`,
      )
      .join('');
  }

  const dataAsOfLine = report.dataAsOf
    ? ` · 数据截至 ${esc(report.dataAsOf)}`
    : '';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(report.title)}</title>
<style>
body{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#0f172a;}
h1{font-size:24px;margin-bottom:4px} .sub{color:#64748b;font-size:13px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px}
.card .label{font-size:12px;color:#64748b} .card .value{font-size:20px;font-weight:600;margin-top:4px}
.up{color:#0ca30c}.down{color:#d03b3b}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:14px}
th{color:#64748b;font-weight:500;font-size:12px}
tr.parent td{background:#f8fafc;border-top:1px solid #e2e8f0}
td.child{padding-left:26px;color:#475569;font-size:13px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:12px;color:#94a3b8;margin-top:24px}
</style></head><body>
<h1>${esc(report.title)}</h1>
<div class="sub">${esc(report.startDate)} ~ ${esc(report.endDate)}${report.wealthLevelName ? ' · 财富等级：' + esc(report.wealthLevelName) : ''}${dataAsOfLine}</div>
<div class="grid">
  <div class="card"><div class="label">期末总资产</div><div class="value">${formatCNY(report.totalAmount)}</div></div>
  <div class="card"><div class="label">期初总资产</div><div class="value">${report.baselineStatus === 'unknown' || report.previousTotalAmount === undefined ? '未知' : formatCNY(report.previousTotalAmount)}</div></div>
  <div class="card"><div class="label">本期变化</div><div class="value ${positive ? 'up' : 'down'}">${report.baselineStatus === 'unknown' || report.previousTotalAmount === undefined ? '—' : `${positive ? '+' : ''}${formatCNY(report.changeAmount)}`}</div></div>
  <div class="card"><div class="label">变化率</div><div class="value ${positive ? 'up' : 'down'}">${report.baselineStatus === 'unknown' || report.previousTotalAmount === undefined ? '—' : `${positive ? '+' : ''}${pct.toFixed(1)}%`}</div></div>
</div>
<table><thead><tr><th>渠道</th><th>金额</th><th>占总资产</th><th>占父渠道</th></tr></thead><tbody>${rows}</tbody></table>
${report.channelSnapshotMissing ? '<p class="note">注：旧版历史记录仅保存总资产，无法还原该日期的渠道构成。</p>' : ''}
${report.compositionWarnings?.length ? `<p class="note">${report.compositionWarnings.map((w) => esc(w)).join('；')}</p>` : ''}
<p class="note">由 WealthGrowthTracker 生成 · ${esc(new Date(report.createdAt).toLocaleString('zh-CN'))}。预测/报告仅供个人参考，不构成投资建议。</p>
</body></html>`;
}
