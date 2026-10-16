import { todayString } from '../../utils/date';
import type { CreateDraftInput } from '../../domain/portfolio/session';
import type { MonthlyReview } from '../../domain/portfolio/types';

/**
 * 创建月度会话的输入推导：规划月份 + 可留空的「快照日」。
 *
 * 默认行为与历史版本一致（快照日＝今天、复盘区间起点＝当月 1 日）；只有当用户显式填写
 * 快照日时才按补录处理，并且把复盘区间起点接到上月已确认会话的快照时点，使 T06 的
 * 区间连续性在同一份数据里自洽。本模块不写任何数据。
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface DraftInputContext {
  planningMonth: string;
  /** 用户填写的快照日；留空字符串表示今天。 */
  snapshotDate: string;
  /** 上月已确认/已归档会话；没有则视为首期。 */
  previous: MonthlyReview | null;
  timezone: string;
  now: string;
  /** 可注入的“今天”，便于测试；缺省取本机日期。 */
  today?: string;
}

export type DraftInputResult =
  | { ok: true; input: CreateDraftInput; notice?: string }
  | { ok: false; message: string };

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year ?? 0, mon ?? 1, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function buildDraftInput(context: DraftInputContext): DraftInputResult {
  if (!MONTH_KEY.test(context.planningMonth)) return { ok: false, message: '规划月份必须是 YYYY-MM' };
  const today = context.today ?? todayString();
  if (!isRealDate(today)) return { ok: false, message: '本机日期无效，请检查系统时间' };

  const raw = context.snapshotDate.trim();
  if (raw && !isRealDate(raw)) return { ok: false, message: '快照日必须是有效日期（YYYY-MM-DD）' };
  const snapshotAsOf = raw || today;
  if (snapshotAsOf > today) return { ok: false, message: `快照日不能晚于今天（${today}）` };

  const periodStart = context.previous ? context.previous.snapshotAsOf : `${context.planningMonth}-01`;
  if (periodStart > snapshotAsOf) {
    return {
      ok: false,
      message: `快照日不能早于上月快照时点 ${periodStart}，否则复盘区间会倒挂`,
    };
  }

  const first = `${context.planningMonth}-01`;
  const last = lastDayOfMonth(context.planningMonth);
  const outsideMonth = snapshotAsOf < first || snapshotAsOf > last;

  return {
    ok: true,
    input: {
      planningMonth: context.planningMonth,
      timezone: context.timezone,
      today: snapshotAsOf,
      now: context.now,
      periodStart,
    },
    ...(outsideMonth
      ? { notice: `快照日 ${snapshotAsOf} 不在 ${context.planningMonth} 内，已按补录处理；请核对来源资料的日期。` }
      : {}),
  };
}
