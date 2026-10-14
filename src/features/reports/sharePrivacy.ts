import type { FinancialReport } from '../../types';
import { formatCNY, formatCompactCNY } from '../../utils/money';

/**
 * 报告分享隐私模式（v1.3）。
 * - full：完整金额
 * - approximate：金额模糊（大额缩写，如 ¥12.3万）
 * - percentage-only：仅显示变化率与渠道占比，不显示任何金额
 * - hidden：金额隐藏（¥••••••）
 */

export type ReportPrivacy = 'full' | 'approximate' | 'percentage-only' | 'hidden';
export type ReportTemplate = 'compact' | 'detailed' | 'social' | 'story';

export const REPORT_PRIVACY_OPTIONS: { value: ReportPrivacy; label: string; description: string }[] = [
  { value: 'full', label: '完整数据', description: '显示完整金额' },
  { value: 'approximate', label: '金额模糊', description: '金额缩写（如 ¥12.3万）' },
  { value: 'percentage-only', label: '仅百分比', description: '只显示变化率与渠道占比' },
  { value: 'hidden', label: '隐藏金额', description: '金额显示为 ¥••••••' },
];

export const REPORT_TEMPLATE_OPTIONS: { value: ReportTemplate; label: string; description: string }[] = [
  { value: 'compact', label: '简洁卡片', description: '横版卡片，仅核心指标' },
  { value: 'detailed', label: '完整报告', description: '横版详情，含渠道构成' },
  { value: 'social', label: '社交分享', description: '竖版 4:5，适合朋友圈/微博' },
  { value: 'story', label: 'Story 9:16', description: '竖版全屏，适合视频号/抖音' },
];

/** 隐私模式下金额展示：percentage-only 返回 null（不显示金额），hidden 返回掩码。 */
export function privacyAmount(value: number, privacy: ReportPrivacy): string | null {
  switch (privacy) {
    case 'full':
      return formatCNY(value);
    case 'approximate':
      return formatCompactCNY(value);
    case 'hidden':
      return '¥••••••';
    case 'percentage-only':
      return null;
  }
}

/** 隐私模式下的变化量展示（percentage-only 仅显示百分比，不显示金额）。 */
export function privacyChange(change: number, changePct: number, privacy: ReportPrivacy): { amount: string | null; pct: string } {
  const pctText = `${change >= 0 ? '+' : ''}${Math.abs(changePct).toFixed(1)}%`;
  if (privacy === 'percentage-only') return { amount: null, pct: pctText };
  const amount = privacy === 'hidden' ? '¥••••••' : privacy === 'approximate' ? formatCompactCNY(change) : formatCNY(change);
  const sign = change >= 0 ? '+' : '';
  return { amount: `${sign}${amount}`, pct: pctText };
}

/** 隐私模式下的占比展示（percentage-only / hidden 仍可显示占比，因为占比不含绝对金额）。 */
export function privacyPercentage(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** 隐私说明脚注。 */
export function privacyFootnote(privacy: ReportPrivacy): string {
  switch (privacy) {
    case 'full':
      return '含完整金额，请谨慎分享';
    case 'approximate':
      return '金额已模糊处理（缩写）';
    case 'percentage-only':
      return '仅显示占比，不含金额';
    case 'hidden':
      return '金额已隐藏';
  }
}

/** 隐私模式下的文字摘要（用于剪贴板 / 邮件正文 / 系统分享 fallback）。 */
export function reportSummaryWithPrivacy(report: FinancialReport, privacy: ReportPrivacy): string {
  const total = privacyAmount(report.totalAmount, privacy);
  const prev = report.previousTotalAmount === undefined || report.baselineStatus === 'unknown' ? null : privacyAmount(report.previousTotalAmount, privacy);
  const change = privacyChange(report.changeAmount, report.changePercentage, privacy);

  const lines = [
    report.title,
    `周期：${report.startDate} ~ ${report.endDate}`,
  ];
  if (total != null) lines.push(`期末总资产：${total}`);
  if (report.previousTotalAmount === undefined || report.baselineStatus === 'unknown') {
    lines.push('期初总资产：未知');
    lines.push('本期变化：无法计算（缺少期初历史快照）');
  } else {
    if (prev != null) lines.push(`期初总资产：${prev}`);
    lines.push(`本期变化：${change.amount != null ? `${change.amount}（${change.pct}）` : change.pct}`);
  }
  lines.push(`财富等级：${report.wealthLevelName ?? '—'}`);
  lines.push(privacy === 'full' ? '' : `（${privacyFootnote(privacy)}）`);
  return lines.join('\n');
}
