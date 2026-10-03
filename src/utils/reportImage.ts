import type { FinancialReport } from '../types';
import { formatCNY } from './money';

const W = 800;
const PAD = 40;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 生成报告分享图片（SVG 字符串，供栅格化为 PNG/JPEG/WebP）。
 * 只包含用户可见的汇总信息（标题/周期/资产/变化/等级/渠道构成），不含完整卡号等敏感原始字段。
 */
export function buildReportSvg(report: FinancialReport, themeColor = '#10B981'): string {
  const positive = report.changeAmount >= 0;
  const changeColor = positive ? '#0ca30c' : '#d03b3b';
  const details = [...report.channelDetails].sort((a, b) => b.amount - a.amount).slice(0, 8);

  const titleY = 70;
  const statsY = 130;
  const statsH = 80;
  const barStartY = statsY + statsH + 60;
  const barH = 30;
  const barGap = 14;
  const barsH = details.length * (barH + barGap);
  const topY = barStartY + barsH + 40;
  const footerY = topY + 60;
  const H = footerY + 50;

  const maxAmount = Math.max(1, ...details.map((d) => d.amount));

  const barRows = details
    .map((d, i) => {
      const y = barStartY + i * (barH + barGap);
      const w = Math.max(4, (d.amount / maxAmount) * (W - 2 * PAD - 200));
      const pct = d.percentage.toFixed(1);
      return `
        <text x="${PAD}" y="${y + barH / 2 + 4}" font-size="14" fill="#334155">${esc(d.emoji ?? '')} ${esc(d.name)}</text>
        <rect x="${W - PAD - 200}" y="${y}" width="${w}" height="${barH}" rx="6" fill="${themeColor}" opacity="0.85"/>
        <text x="${W - PAD - 200 + w + 8}" y="${y + barH / 2 + 4}" font-size="13" fill="#475569">${formatCNY(d.amount)} (${pct}%)</text>`;
    })
    .join('');

  const top3 = (report.topChannels ?? [])
    .map((c) => `${c.emoji} ${c.name} ${c.percentage.toFixed(1)}%`)
    .join(' · ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${themeColor}"/>
  <text x="${PAD}" y="${titleY}" font-size="24" font-weight="700" fill="#0f172a">${esc(report.title)}</text>
  <text x="${PAD}" y="${titleY + 26}" font-size="14" fill="#64748b">${esc(report.startDate)} ~ ${esc(report.endDate)} · 财富等级 ${esc(report.wealthLevelName ?? '—')}</text>

  <g font-family="system-ui,sans-serif">
    <rect x="${PAD}" y="${statsY}" width="170" height="${statsH}" rx="10" fill="#f8fafc"/>
    <text x="${PAD + 14}" y="${statsY + 28}" font-size="12" fill="#64748b">期末总资产</text>
    <text x="${PAD + 14}" y="${statsY + 58}" font-size="20" font-weight="600" fill="#0f172a">${formatCNY(report.totalAmount)}</text>

    <rect x="${PAD + 182}" y="${statsY}" width="170" height="${statsH}" rx="10" fill="#f8fafc"/>
    <text x="${PAD + 196}" y="${statsY + 28}" font-size="12" fill="#64748b">期初总资产</text>
    <text x="${PAD + 196}" y="${statsY + 58}" font-size="20" font-weight="600" fill="#0f172a">${formatCNY(report.previousTotalAmount ?? 0)}</text>

    <rect x="${PAD + 364}" y="${statsY}" width="170" height="${statsH}" rx="10" fill="#f8fafc"/>
    <text x="${PAD + 378}" y="${statsY + 28}" font-size="12" fill="#64748b">本期变化</text>
    <text x="${PAD + 378}" y="${statsY + 58}" font-size="20" font-weight="600" fill="${changeColor}">${positive ? '+' : ''}${formatCNY(report.changeAmount)}</text>

    <rect x="${PAD + 546}" y="${statsY}" width="170" height="${statsH}" rx="10" fill="#f8fafc"/>
    <text x="${PAD + 560}" y="${statsY + 28}" font-size="12" fill="#64748b">变化率</text>
    <text x="${PAD + 560}" y="${statsY + 58}" font-size="20" font-weight="600" fill="${changeColor}">${positive ? '+' : ''}${Math.abs(report.changePercentage).toFixed(1)}%</text>
  </g>

  <text x="${PAD}" y="${barStartY - 16}" font-size="15" font-weight="600" fill="#0f172a">资产构成</text>
  ${barRows}

  <text x="${PAD}" y="${topY}" font-size="13" fill="#475569">TOP 渠道：${esc(top3 || '—')}</text>
  <text x="${PAD}" y="${topY + 22}" font-size="11" fill="#94a3b8">由「财富成长记」生成 · 仅供个人参考，不构成投资建议</text>
  <text x="${PAD}" y="${topY + 40}" font-size="11" fill="#94a3b8">${esc(new Date(report.createdAt).toLocaleString('zh-CN'))}</text>
</svg>`;
}
