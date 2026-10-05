import type { FinancialReport, ReportType } from '../../types';
import { round2 } from '../../utils/money';
import { parseDateString, pad2 } from '../../utils/date';

/**
 * 历史财务报告导入器（v1.5）：把「历史财务报告」目录里的旧 TXT / 图片
 * 解析成结构化候选报告，并与现有 History / Report 做 reconciliation。
 *
 * 事实来源优先级（绝不猜）：
 *  1. HistoryPoint（真实 totalAmount / channels snapshot）
 *  2. 旧报告 TXT 中的结构化数据
 *  3. 已有 FinancialReport 对象
 *  4. 图片（仅交叉验证，或 TXT 不存在时的最后来源）
 */

export interface LegacyFileEntry {
  name: string;
  /** basename（去扩展名）。 */
  basename: string;
  kind: 'txt' | 'image' | 'other';
}

/** 按 basename / 日期 / 标题把 TXT 与图片配成同一份报告。 */
export function pairLegacyFiles(files: { name: string }[]): { basename: string; txt: string | null; image: string | null }[] {
  const groups = new Map<string, { txt: string | null; image: string | null }>();
  for (const f of files) {
    const dot = f.name.lastIndexOf('.');
    const basename = dot > 0 ? f.name.slice(0, dot) : f.name;
    const lower = f.name.toLowerCase();
    const g = groups.get(basename) ?? { txt: null, image: null };
    if (lower.endsWith('.txt')) g.txt = f.name;
    else if (/\.(png|jpe?g|webp)$/i.test(lower)) g.image = f.name;
    groups.set(basename, g);
  }
  return [...groups.entries()].map(([basename, g]) => ({ basename, txt: g.txt, image: g.image }));
}

export interface ParsedChannelLine {
  name: string;
  amount: number | null;
  percentage: number | null;
}

export interface ParsedLegacyReport {
  reportType: ReportType | null;
  periodKey: string | null;
  startDate: string | null;
  endDate: string | null;
  title: string | null;
  totalAmount: number | null;
  previousTotalAmount: number | null;
  changeAmount: number | null;
  wealthLevel: string | null;
  dataAsOf: string | null;
  channels: ParsedChannelLine[];
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

function toNum(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(String(s).replace(/[￥¥,，\s]/g, ''));
  return Number.isFinite(n) ? round2(n) : null;
}

function dateReOf(text: string): { startDate: string | null; endDate: string | null } {
  const d = /(\d{4})-(\d{2})-(\d{2})\s*[~～至]\s*(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (d) return { startDate: `${d[1]}-${d[2]}-${d[3]}`, endDate: `${d[4]}-${d[5]}-${d[6]}` };
  const single = /(\d{4})[-年](\d{1,2})(?:[-月](\d{1,2}))?/.exec(text);
  if (single) {
    const y = Number(single[1]);
    const m = Number(single[2]);
    const day = single[3] ? Number(single[3]) : null;
    return day ? { startDate: `${y}-${pad2(m)}-${pad2(day)}`, endDate: null } : { startDate: null, endDate: null };
  }
  return { startDate: null, endDate: null };
}

/** 解析旧报告 TXT（best-effort；低置信度字段进入 Manual Review，绝不自动写入）。 */
export function parseLegacyReportText(text: string, filename: string): ParsedLegacyReport {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 报告类型
  let reportType: ReportType | null = null;
  if (/周/.test(filename) || /周/.test(lines[0] ?? '')) reportType = 'weekly';
  else if (/年(?!报)/.test(filename) && /年报/.test(text)) reportType = 'yearly';
  else if (/月/.test(filename) || /月/.test(lines[0] ?? '')) reportType = 'monthly';
  else if (/年报/.test(text)) reportType = 'yearly';
  if (!reportType) warnings.push('无法可靠判断报告类型');

  const { startDate, endDate } = dateReOf(text);

  // 金额字段
  const totalAmount = toNum(
    /(?:期末|总资产|当前资产)\s*(?:总资产)?\s*[：:]\s*[￥¥]?([-+]?\d[\d,]*(?:\.\d+)?)/.exec(text)?.[1]
      ?? /(?:期末|总资产)\s*[￥¥]?\s*([-+]?\d[\d,]*(?:\.\d+)?)/.exec(text)?.[1],
  );
  const previousTotalAmount = toNum(
    /期初\s*[：:]?\s*[￥¥]?([-+]?\d[\d,]*(?:\.\d+)?)/.exec(text)?.[1],
  );
  const wealthLevel = /财富等级\s*[：:]\s*(.+)/.exec(text)?.[1]?.trim() ?? null;
  const dataAsOf = /数据截至\s*[：:]?\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null;

  // 渠道行（名称 + 金额/百分比）
  const channels: ParsedChannelLine[] = [];
  for (const line of lines) {
    if (/渠道|构成|占比|资产|余额|支付宝|微信|银行|现金/.test(line)) {
      const m = /^(.{1,24}?)\s+[￥¥]?([-+]?\d[\d,]*(?:\.\d+)?)\s*(?:\((\d+(?:\.\d+)?)%\)|(\d+(?:\.\d+)?)%)?/.exec(line);
      if (m && m[1] && toNum(m[2]) !== null) {
        channels.push({ name: m[1].trim(), amount: toNum(m[2]), percentage: m[3] || m[4] ? Number(m[3] ?? m[4]) : null });
      }
    }
  }

  let confidence: ParsedLegacyReport['confidence'] = 'low';
  if (totalAmount !== null && reportType !== null) confidence = 'medium';
  if (totalAmount !== null && reportType !== null && startDate && channels.length > 0) confidence = 'high';
  if (totalAmount === null) warnings.push('未解析到总资产金额（可能需人工确认）');

  return {
    reportType,
    periodKey: null,
    startDate,
    endDate,
    title: null,
    totalAmount,
    previousTotalAmount,
    changeAmount: totalAmount !== null && previousTotalAmount !== null ? round2(totalAmount - previousTotalAmount) : null,
    wealthLevel,
    dataAsOf,
    channels,
    notes: null,
    confidence,
    warnings,
  };
}

export interface MigrationManifestEntry {
  basename: string;
  sourceTxt: string | null;
  sourceImage: string | null;
  reportType: ReportType | null;
  periodKey: string | null;
  importAction: 'create' | 'merge' | 'repair' | 'skip' | 'manual-review';
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

/** 与现有报告/history 做 reconciliation，输出迁移清单（只读，不写数据）。 */
export function buildMigrationManifest(
  files: { name: string }[],
  parsedByTxt: Map<string, ParsedLegacyReport>,
  existingPeriodKeys: Set<string>,
): MigrationManifestEntry[] {
  return pairLegacyFiles(files).map((pair) => {
    const parsed = pair.txt ? parsedByTxt.get(pair.txt) : undefined;
    const warnings = parsed?.warnings ?? (pair.txt ? [] : ['仅有图片，无 TXT，图片只作辅助']);

    if (!parsed || parsed.totalAmount === null) {
      return {
        basename: pair.basename,
        sourceTxt: pair.txt,
        sourceImage: pair.image,
        reportType: parsed?.reportType ?? null,
        periodKey: null,
        importAction: 'manual-review',
        confidence: 'low',
        warnings: [...warnings, '无法可靠解析，进入人工确认'],
      };
    }

    const periodKey = parsed.periodKey;
    const hasExisting = periodKey ? existingPeriodKeys.has(periodKey) : false;

    let importAction: MigrationManifestEntry['importAction'];
    if (parsed.confidence === 'low') importAction = 'manual-review';
    else if (hasExisting) importAction = 'merge';
    else importAction = 'create';

    return {
      basename: pair.basename,
      sourceTxt: pair.txt,
      sourceImage: pair.image,
      reportType: parsed.reportType,
      periodKey,
      importAction,
      confidence: parsed.confidence,
      warnings,
    };
  });
}

/** 由解析结果 + 现有报告构造候选报告对象（用于 Import Preview，不直接写数据）。 */
export function buildCandidateReport(
  parsed: ParsedLegacyReport,
  existing: FinancialReport | null,
  now = new Date().toISOString(),
): FinancialReport {
  const reportType = parsed.reportType ?? 'monthly';
  const endDate = parsed.endDate ?? parsed.startDate ?? (parsed.dataAsOf ?? '');
  const d = endDate ? parseDateString(endDate) : new Date();
  const base: FinancialReport = existing ?? {
    id: `legacy_${Date.now().toString(36)}`,
    reportType,
    startDate: parsed.startDate ?? endDate,
    endDate,
    title: `${d.getFullYear()}年${d.getMonth() + 1}月月度财务报告`,
    totalAmount: parsed.totalAmount ?? 0,
    changeAmount: parsed.changeAmount ?? 0,
    changePercentage: 0,
    channelDetails: [],
    isArchived: false,
    createdAt: now,
  };

  return {
    ...base,
    totalAmount: parsed.totalAmount ?? base.totalAmount,
    previousTotalAmount: parsed.previousTotalAmount ?? base.previousTotalAmount,
    changeAmount: parsed.changeAmount ?? base.changeAmount,
    wealthLevelName: parsed.wealthLevel ?? base.wealthLevelName,
    ...(parsed.dataAsOf ? { dataAsOf: parsed.dataAsOf } : {}),
    generationSource: 'legacy-txt-import',
  };
}
