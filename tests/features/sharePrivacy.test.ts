import { describe, it, expect } from 'vitest';
import type { FinancialReport } from '../../src/types';
import {
  privacyAmount,
  privacyChange,
  reportSummaryWithPrivacy,
} from '../../src/features/reports/sharePrivacy';
import { buildReportSvg } from '../../src/utils/reportImage';

function report(): FinancialReport {
  return {
    id: 'r',
    reportType: 'weekly',
    startDate: '2026-09-28',
    endDate: '2026-10-04',
    title: '2026年第40周周度财务报告',
    totalAmount: 123456.78,
    previousTotalAmount: 100000,
    changeAmount: 23456.78,
    changePercentage: 23.46,
    channelDetails: [
      { id: 'a', name: '支付宝', emoji: '💙', amount: 80000, isParent: true, children: [], percentage: 64.8 },
      { id: 'b', name: '微信', emoji: '💚', amount: 43456.78, isParent: true, children: [], percentage: 35.2 },
    ],
    isArchived: false,
    createdAt: '2026-10-04T00:00:00.000Z',
    wealthLevelName: '投资专家',
    wealthLevelTheme: 'red-royal',
    wealthLevelColor: '#B91C1C',
    periodKey: 'weekly:2026-W40',
  };
}

describe('分享隐私模式', () => {
  it('full 显示完整金额', () => {
    expect(privacyAmount(123456.78, 'full')).toContain('123,456.78');
  });

  it('approximate 显示缩写', () => {
    expect(privacyAmount(123456.78, 'approximate')).toContain('万');
  });

  it('hidden 显示掩码而非真实金额', () => {
    expect(privacyAmount(123456.78, 'hidden')).toBe('¥••••••');
    expect(privacyAmount(123456.78, 'hidden')).not.toContain('123');
  });

  it('percentage-only 不显示金额', () => {
    expect(privacyAmount(123456.78, 'percentage-only')).toBeNull();
    const change = privacyChange(23456.78, 23.46, 'percentage-only');
    expect(change.amount).toBeNull();
    expect(change.pct).toBe('+23.5%');
  });

  it('隐藏模式下 SVG 不出现真实金额字符串', () => {
    const svg = buildReportSvg(report(), { privacy: 'hidden' });
    expect(svg).toContain('¥••••••');
    expect(svg).not.toContain('123,456.78');
    expect(svg).not.toContain('123456.78');
    expect(svg).not.toContain('23,456.78');
  });

  it('仅百分比模式下 SVG 不出现任何金额', () => {
    const svg = buildReportSvg(report(), { privacy: 'percentage-only' });
    expect(svg).not.toContain('123,456.78');
    expect(svg).not.toContain('80,000');
    expect(svg).toContain('64.8%');
  });

  it('文字摘要尊重隐私模式', () => {
    const full = reportSummaryWithPrivacy(report(), 'full');
    expect(full).toContain('123,456.78');

    const hidden = reportSummaryWithPrivacy(report(), 'hidden');
    expect(hidden).toContain('¥••••••');
    expect(hidden).not.toContain('123,456.78');
  });

  it('模板维度正确', () => {
    const compact = buildReportSvg(report(), { template: 'compact' });
    expect(compact).toContain('width="800"');
    const story = buildReportSvg(report(), { template: 'story' });
    expect(story).toContain('width="1080" height="1920"');
  });
});
