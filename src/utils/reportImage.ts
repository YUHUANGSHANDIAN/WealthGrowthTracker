import type { FinancialReport } from '../types';
import { getLevelByTheme } from '../constants/levels';
import {
  privacyAmount,
  privacyChange,
  privacyPercentage,
  privacyFootnote,
  type ReportPrivacy,
  type ReportTemplate,
} from '../features/reports/sharePrivacy';

/**
 * 报告分享图片渲染器（结构化 SVG，供栅格化为 PNG/JPEG/WebP）。
 * - 支持 4 种模板：compact / detailed / social / story。
 * - 支持 4 种隐私模式：full / approximate / percentage-only / hidden。
 * - 主题色跟随报告当时保存的 wealthLevelTheme（而非用户今天的等级）。
 * - 只渲染报告已保存的真实字段，不生成虚构数据（无历史序列时不画 sparkline）。
 */

export type ReportBackground = 'light' | 'theme' | 'transparent';

export interface ReportRenderOptions {
  template?: ReportTemplate;
  privacy?: ReportPrivacy;
  background?: ReportBackground;
}

interface Palette {
  primary: string;
  accent: string;
  surface: string;
  surfaceSoft: string;
  textOnPrimary: string;
  border: string;
  heroGradient: string;
  muted: string;
  ink: string;
}

const NEUTRAL: Palette = {
  primary: '#10B981',
  accent: '#059669',
  surface: '#ECFDF5',
  surfaceSoft: '#F7FEFA',
  textOnPrimary: '#FFFFFF',
  border: '#A7F3D0',
  heroGradient: 'linear-gradient(135deg,#D1FAE5 0%,#A7F3D0 55%,#6EE7B7 100%)',
  muted: '#64748b',
  ink: '#0f172a',
};

function paletteOf(report: FinancialReport): Palette {
  const tokens = getLevelByTheme(report.wealthLevelTheme ?? '')?.tokens;
  if (!tokens) return NEUTRAL;
  return {
    primary: tokens.primary,
    accent: tokens.accent,
    surface: tokens.surface,
    surfaceSoft: tokens.surfaceSoft,
    textOnPrimary: tokens.textOnPrimary,
    border: tokens.border,
    heroGradient: tokens.heroGradient,
    muted: '#64748b',
    ink: '#0f172a',
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SIZES: Record<ReportTemplate, { w: number; h: number }> = {
  compact: { w: 800, h: 480 },
  detailed: { w: 1000, h: 700 },
  social: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

const UP = '#0ca30c';
const DOWN = '#d03b3b';

function changeColor(change: number): string {
  return change >= 0 ? UP : DOWN;
}

/** 渲染一份报告为 SVG 字符串。 */
export function buildReportSvg(
  report: FinancialReport,
  options: ReportRenderOptions = {},
  legacyThemeColor?: string,
): string {
  const template = options.template ?? 'detailed';
  const privacy = options.privacy ?? 'full';
  const background = options.background ?? 'light';
  const { w: W, h: H } = SIZES[template];
  const pal = paletteOf(report);
  if (legacyThemeColor) pal.primary = legacyThemeColor;

  const baselineUnknown = report.baselineStatus === 'unknown' || report.previousTotalAmount === undefined;
  const change = privacyChange(report.changeAmount, report.changePercentage, privacy);
  const totalText = privacyAmount(report.totalAmount, privacy) ?? '';
  const prevText = baselineUnknown ? null : privacyAmount(report.previousTotalAmount!, privacy);
  const levelText = report.wealthLevelName ?? '—';

  const bg = background === 'transparent' ? '' : `<rect width="${W}" height="${H}" fill="${background === 'theme' ? pal.surfaceSoft : '#ffffff'}"/>`;

  // —— 头部 ——
  const header = `
  <rect x="0" y="0" width="${W}" height="6" fill="${pal.primary}"/>
  <text x="40" y="64" font-size="22" font-weight="700" fill="${pal.ink}">WealthGrowthTracker</text>
  <text x="40" y="88" font-size="13" fill="${pal.muted}">个人财富成长 · 本地隐私优先</text>`;

  const badge = `<g><rect x="${W - 40 - 150}" y="34" width="150" height="34" rx="17" fill="${pal.surface}"/><rect x="${W - 40 - 150}" y="34" width="150" height="34" rx="17" fill="none" stroke="${pal.border}"/><text x="${W - 40 - 75}" y="56" font-size="14" font-weight="600" text-anchor="middle" fill="${pal.primary}">🏆 ${esc(levelText)}</text></g>`;

  const period = `${esc(report.startDate)} ~ ${esc(report.endDate)}${report.dataAsOf ? ` · 数据截至 ${esc(report.dataAsOf)}` : ''}`;

  // —— 标题 + 周期 ——
  const titleBlock = `
  <text x="40" y="${template === 'compact' ? 150 : 170}" font-size="${template === 'compact' ? 26 : 34}" font-weight="700" fill="${pal.ink}">${esc(report.title)}</text>
  <text x="40" y="${template === 'compact' ? 178 : 204}" font-size="15" fill="${pal.muted}">${period}</text>`;

  // —— 核心 KPI ——
  const totalLabelY = template === 'compact' ? 250 : 290;
  const totalValueY = template === 'compact' ? 310 : 360;
  const totalFont = template === 'compact' ? 48 : 64;

  const kpi = `
  <text x="40" y="${totalLabelY}" font-size="15" fill="${pal.muted}">期末总资产</text>
  <text x="40" y="${totalValueY}" font-size="${totalFont}" font-weight="700" fill="${pal.ink}">${esc(totalText)}</text>
  <text x="40" y="${totalValueY + 34}" font-size="18" font-weight="600" fill="${changeColor(report.changeAmount)}">${baselineUnknown ? '变化未知' : `${privacy !== 'percentage-only' ? `${esc(change.amount ?? '')}  ` : ''}${esc(change.pct)}`}</text>`;

  // —— 次级统计（detailed / social / story）——
  let stats = '';
  if (template !== 'compact') {
    const prev = prevText ?? '—';
    const max = privacyAmount(report.reportType === 'weekly' ? report.weeklyMax ?? report.totalAmount : report.reportType === 'monthly' ? report.monthlyMax ?? report.totalAmount : report.yearlyMax ?? report.totalAmount, privacy);
    const min = privacyAmount(report.reportType === 'weekly' ? report.weeklyMin ?? report.totalAmount : report.reportType === 'monthly' ? report.monthlyMin ?? report.totalAmount : report.yearlyMin ?? report.totalAmount, privacy);
    const avg = privacyAmount(report.reportType === 'weekly' ? report.weeklyAvg ?? report.totalAmount : report.reportType === 'monthly' ? report.monthlyAvg ?? report.totalAmount : report.yearlyAvg ?? report.totalAmount, privacy);

    const cards = [
      { label: '期初总资产', value: baselineUnknown ? '未知' : prev ?? '—' },
      { label: '期间最高', value: max ?? '—' },
      { label: '期间最低', value: min ?? '—' },
      { label: '期间平均', value: avg ?? '—' },
    ];
    const cw = (W - 80 - 3 * 12) / 4;
    stats = cards
      .map((c, i) => {
        const x = 40 + i * (cw + 12);
        return `<g><rect x="${x}" y="${totalValueY + 66}" width="${cw}" height="78" rx="12" fill="${pal.surfaceSoft}" stroke="${pal.border}"/><text x="${x + 16}" y="${totalValueY + 94}" font-size="12" fill="${pal.muted}">${c.label}</text><text x="${x + 16}" y="${totalValueY + 128}" font-size="20" font-weight="600" fill="${pal.ink}">${esc(c.value)}</text></g>`;
      })
      .join('');
  }

  // —— 渠道构成（父渠道 + 可选 TOP 子渠道，避免父子混淆）——
  const comp = report.assetComposition;
  const parentRows = comp && comp.parents.length > 0 ? [...comp.parents].sort((a, b) => b.amount - a.amount) : [];
  const flatDetails = [...report.channelDetails].sort((a, b) => b.amount - a.amount);
  const maxParents = template === 'story' ? 6 : template === 'compact' ? 3 : 5;
  let channels = '';
  if (template === 'compact') {
    const source = parentRows.length > 0 ? parentRows : flatDetails;
    const top3 = source
      .slice(0, 3)
      .map((d) => `${esc(d.emoji ?? '')} ${esc(d.name)} ${privacyPercentage('percentageOfTotal' in d ? d.percentageOfTotal : d.percentage)}`)
      .join('  ·  ');
    channels = `<text x="40" y="${totalValueY + 66}" font-size="14" fill="#475569">TOP：${top3}</text>`;
  } else if (parentRows.length > 0) {
    const barStartY = (template === 'social' || template === 'story' ? totalValueY + 210 : totalValueY + 200);
    const barH = template === 'story' ? 30 : 24;
    const labelW = 190;
    const barX = 40 + labelW + 16;
    const barMaxW = W - 40 - barX - 130;
    const maxAmount = Math.max(1, ...parentRows.map((p) => p.amount));
    let y = barStartY;
    channels = `<text x="40" y="${y - 16}" font-size="16" font-weight="600" fill="${pal.ink}">资产构成</text>`;

    for (const p of parentRows.slice(0, maxParents)) {
      const w = Math.max(4, (p.amount / maxAmount) * barMaxW);
      const pct = privacyPercentage(p.percentageOfTotal);
      const amt = privacyAmount(p.amount, privacy);
      const amountText = amt != null && amt !== '' ? ` ${esc(amt)}` : '';
      channels += `<g>
        <text x="40" y="${y + barH / 2 + 5}" font-size="14" font-weight="600" fill="#1f2937">${esc(p.emoji ?? '')} ${esc(p.name)}</text>
        <rect x="${barX}" y="${y}" width="${w}" height="${barH}" rx="6" fill="${pal.primary}" opacity="0.85"/>
        <text x="${barX + w + 8}" y="${y + barH / 2 + 5}" font-size="13" fill="#475569">${pct}${amountText}</text>
      </g>`;
      y += barH + 12;
      if (p.children.length > 0) {
        const topChildren = [...p.children].sort((a, b) => b.amount - a.amount).slice(0, 3);
        const childText = topChildren
          .map((c) => `${esc(c.emoji ?? '')} ${esc(c.name)} ${privacyPercentage(c.percentageOfTotal)}`)
          .join('  ·  ');
        channels += `<text x="64" y="${y + 6}" font-size="12" fill="#64748b">└ ${childText}</text>`;
        y += 18;
      }
      y += 6;
    }
  } else if (flatDetails.length > 0) {
    // 旧版扁平叶子渠道（无父子映射）
    const barStartY = (template === 'social' || template === 'story' ? totalValueY + 210 : totalValueY + 200);
    const barH = template === 'story' ? 40 : 30;
    const gap = template === 'story' ? 22 : 14;
    const maxAmount = Math.max(1, ...flatDetails.map((d) => d.amount));
    const labelW = 220;
    const barX = 40 + labelW + 16;
    const barMaxW = W - 40 - barX - 120;

    channels = `<text x="40" y="${barStartY - 16}" font-size="16" font-weight="600" fill="${pal.ink}">资产构成</text>`;
    channels += flatDetails
      .slice(0, 8)
      .map((d, i) => {
        const yy = barStartY + i * (barH + gap);
        const w = Math.max(4, (d.amount / maxAmount) * barMaxW);
        const pct = privacyPercentage(d.percentage);
        const amt = privacyAmount(d.amount, privacy);
        const amountText = amt != null && amt !== '' ? ` ${esc(amt)}` : '';
        return `<g>
          <text x="40" y="${yy + barH / 2 + 5}" font-size="14" fill="#334155">${esc(d.emoji ?? '')} ${esc(d.name)}</text>
          <rect x="${barX}" y="${yy}" width="${w}" height="${barH}" rx="7" fill="${pal.primary}" opacity="0.85"/>
          <text x="${barX + w + 8}" y="${yy + barH / 2 + 5}" font-size="13" fill="#475569">${pct}${amountText}</text>
        </g>`;
      })
      .join('');
  }

  // —— 底部 ——
  const footerY = H - 40;
  const footnote = privacyFootnote(privacy);
  const footer = `
  <text x="40" y="${footerY - 24}" font-size="12" fill="#94a3b8">由 WealthGrowthTracker 生成 · ${esc(footnote)} · 仅供个人参考，不构成投资建议</text>
  <text x="40" y="${footerY}" font-size="12" fill="#94a3b8">${esc(new Date(report.createdAt).toLocaleString('zh-CN'))}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  ${bg}
  ${header}
  ${badge}
  ${titleBlock}
  ${kpi}
  ${stats}
  ${channels}
  ${footer}
</svg>`;
}
