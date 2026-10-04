import type { WealthLevel } from '../types';

/**
 * 财富等级体系 —— 与旧版保持一致的名称、阈值、主题色与里程碑。
 * 每个等级带有结构化视觉 Theme Token（映射为 CSS Variables，全局生效）。
 *
 * 注意：红色系等级（财富管家/投资专家）的 primary 仅用于背景氛围、边框、装饰与等级身份，
 * 不会大面积用于正常资产数字，避免金融 UI 中红色被误解为「下降/风险」。
 */

const MILESTONES = (names: string[]): WealthLevel['milestones'] => [
  { percentage: 10, name: names[0]!, emoji: '🌱' },
  { percentage: 25, name: names[1]!, emoji: '💰' },
  { percentage: 50, name: names[2]!, emoji: '🏆' },
  { percentage: 75, name: names[3]!, emoji: '🚀' },
  { percentage: 90, name: names[4]!, emoji: '⭐' },
  { percentage: 100, name: names[5]!, emoji: '🎉' },
];

export const WEALTH_LEVELS: WealthLevel[] = [
  {
    name: '理财新手',
    minAmount: 0,
    maxAmount: 9_999,
    badge: '🌱',
    color: '#10B981',
    description: '开始理财之旅',
    theme: 'green-nature',
    tokens: {
      primary: '#10B981',
      secondary: '#34D399',
      accent: '#059669',
      surface: '#ECFDF5',
      surfaceSoft: '#F7FEFA',
      textOnPrimary: '#FFFFFF',
      border: '#A7F3D0',
      glow: 'rgba(16,185,129,0.35)',
      progressGradient: 'linear-gradient(90deg,#34D399,#059669)',
      heroGradient: 'linear-gradient(135deg,#D1FAE5 0%,#A7F3D0 55%,#6EE7B7 100%)',
      particleColor: '#6EE7B7',
      chartAccent: '#10B981',
    },
    milestones: MILESTONES(['起步阶段', '小有积蓄', '半程目标', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '储蓄达人',
    minAmount: 10_000,
    maxAmount: 49_999,
    badge: '💪',
    color: '#3B82F6',
    description: '养成储蓄好习惯',
    theme: 'blue-ocean',
    tokens: {
      primary: '#3B82F6',
      secondary: '#60A5FA',
      accent: '#06B6D4',
      surface: '#EFF6FF',
      surfaceSoft: '#F8FBFF',
      textOnPrimary: '#FFFFFF',
      border: '#BFDBFE',
      glow: 'rgba(59,130,246,0.35)',
      progressGradient: 'linear-gradient(90deg,#60A5FA,#06B6D4)',
      heroGradient: 'linear-gradient(135deg,#DBEAFE 0%,#BFDBFE 55%,#A5F3FC 100%)',
      particleColor: '#93C5FD',
      chartAccent: '#3B82F6',
    },
    milestones: MILESTONES(['稳步积累', '四分之一', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '财富学徒',
    minAmount: 50_000,
    maxAmount: 99_999,
    badge: '📚',
    color: '#8B5CF6',
    description: '掌握理财基础知识',
    theme: 'purple-wisdom',
    tokens: {
      primary: '#8B5CF6',
      secondary: '#A78BFA',
      accent: '#6366F1',
      surface: '#F5F3FF',
      surfaceSoft: '#FBFAFF',
      textOnPrimary: '#FFFFFF',
      border: '#DDD6FE',
      glow: 'rgba(139,92,246,0.35)',
      progressGradient: 'linear-gradient(90deg,#A78BFA,#6366F1)',
      heroGradient: 'linear-gradient(135deg,#EDE9FE 0%,#DDD6FE 55%,#C7D2FE 100%)',
      particleColor: '#C4B5FD',
      chartAccent: '#8B5CF6',
    },
    milestones: MILESTONES(['知识积累', '技能提升', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '投资能手',
    minAmount: 100_000,
    maxAmount: 299_999,
    badge: '🎯',
    color: '#F59E0B',
    description: '投资技巧日益精进',
    theme: 'golden-sunset',
    tokens: {
      primary: '#F59E0B',
      secondary: '#FBBF24',
      accent: '#F97316',
      surface: '#FFFBEB',
      surfaceSoft: '#FFFEFA',
      textOnPrimary: '#FFFFFF',
      border: '#FDE68A',
      glow: 'rgba(245,158,11,0.35)',
      progressGradient: 'linear-gradient(90deg,#FBBF24,#F97316)',
      heroGradient: 'linear-gradient(135deg,#FEF3C7 0%,#FDE68A 55%,#FED7AA 100%)',
      particleColor: '#FCD34D',
      chartAccent: '#F59E0B',
    },
    milestones: MILESTONES(['投资起步', '初见成效', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '财富管家',
    minAmount: 300_000,
    maxAmount: 499_999,
    badge: '🏆',
    color: '#9F1239',
    description: '财务管理井井有条',
    theme: 'crimson-imperial',
    tokens: {
      primary: '#9F1239',
      secondary: '#E11D48',
      accent: '#D4AF37',
      surface: '#FFF1F2',
      surfaceSoft: '#FFF9F9',
      textOnPrimary: '#FFFFFF',
      border: '#FECDD3',
      glow: 'rgba(159,18,57,0.30)',
      progressGradient: 'linear-gradient(90deg,#E11D48,#D4AF37)',
      heroGradient: 'linear-gradient(135deg,#FFE4E6 0%,#FECDD3 55%,#FEF3C7 100%)',
      particleColor: '#FDA4AF',
      chartAccent: '#9F1239',
    },
    milestones: MILESTONES(['资产配置', '稳健增长', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '投资专家',
    minAmount: 500_000,
    maxAmount: 799_999,
    badge: '👑',
    color: '#B91C1C',
    description: '投资眼光独到精准',
    theme: 'red-royal',
    tokens: {
      primary: '#B91C1C',
      secondary: '#EF4444',
      accent: '#F59E0B',
      surface: '#FEF2F2',
      surfaceSoft: '#FFFBFB',
      textOnPrimary: '#FFFFFF',
      border: '#FECACA',
      glow: 'rgba(185,28,28,0.30)',
      progressGradient: 'linear-gradient(90deg,#EF4444,#F59E0B)',
      heroGradient: 'linear-gradient(135deg,#FEE2E2 0%,#FECACA 55%,#FEF3C7 100%)',
      particleColor: '#FCA5A5',
      chartAccent: '#B91C1C',
    },
    milestones: MILESTONES(['专家起步', '投资回报', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '财富大师',
    minAmount: 800_000,
    maxAmount: 999_999,
    badge: '💎',
    color: '#7C3AED',
    description: '财富管理炉火纯青',
    theme: 'amethyst-majesty',
    tokens: {
      primary: '#7C3AED',
      secondary: '#A78BFA',
      accent: '#C084FC',
      surface: '#F5F3FF',
      surfaceSoft: '#FBF8FF',
      textOnPrimary: '#FFFFFF',
      border: '#DDD6FE',
      glow: 'rgba(124,58,237,0.38)',
      progressGradient: 'linear-gradient(90deg,#A78BFA,#C084FC)',
      heroGradient: 'linear-gradient(135deg,#EDE9FE 0%,#E9D5FF 55%,#DDD6FE 100%)',
      particleColor: '#C4B5FD',
      chartAccent: '#7C3AED',
    },
    milestones: MILESTONES(['大师起步', '财富增值', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
  {
    name: '百万富翁',
    minAmount: 1_000_000,
    maxAmount: Number.POSITIVE_INFINITY,
    badge: '🏰',
    color: '#D4AF37',
    description: '恭喜实现百万梦想',
    theme: 'golden-legend',
    tokens: {
      primary: '#D4AF37',
      secondary: '#FCD34D',
      accent: '#1E3A8A',
      surface: '#FFFBEB',
      surfaceSoft: '#FFFFFB',
      textOnPrimary: '#1F2937',
      border: '#FDE68A',
      glow: 'rgba(212,175,55,0.42)',
      progressGradient: 'linear-gradient(90deg,#FCD34D,#D4AF37)',
      heroGradient: 'linear-gradient(135deg,#FEF3C7 0%,#FDE68A 55%,#DBEAFE 100%)',
      particleColor: '#FCD34D',
      chartAccent: '#D4AF37',
    },
    milestones: MILESTONES(['百万起步', '财富积累', '半程节点', '冲刺阶段', '接近目标', '达成目标']),
  },
];

/** 根据总资产返回当前财富等级（倒序找第一个满足 minAmount 的）。 */
export function getLevelByAmount(total: number): WealthLevel {
  const found = [...WEALTH_LEVELS].reverse().find((l) => total >= l.minAmount);
  return found ?? WEALTH_LEVELS[0]!;
}

/** 等级下标。 */
export function getLevelIndex(level: WealthLevel): number {
  return WEALTH_LEVELS.indexOf(level);
}

/** 按主题 key 查找等级（用于报告按保存的 theme 还原视觉，而非今天等级）。 */
export function getLevelByTheme(theme: string): WealthLevel | undefined {
  return WEALTH_LEVELS.find((l) => l.theme === theme);
}

/** 下一等级（最高级返回 null）。 */
export function getNextLevel(level: WealthLevel): WealthLevel | null {
  const idx = getLevelIndex(level);
  return idx >= 0 && idx < WEALTH_LEVELS.length - 1 ? WEALTH_LEVELS[idx + 1]! : null;
}

/** 百万财富目标（默认目标金额，用于目标进度卡片）。 */
export const DEFAULT_GOAL_AMOUNT = 1_000_000;

/** 渠道默认配色（与旧版 primary 色板一致）。 */
export const CHANNEL_COLORS = {
  blue: '#3B82F6',
  green: '#10B981',
  orange: '#F59E0B',
  cyan: '#06B6D4',
  purple: '#8B5CF6',
  pink: '#EC4899',
  red: '#EF4444',
  slate: '#64748B',
} as const;

export const CHANNEL_EMOJIS = ['💙', '💚', '🔶', '🎓', '🏛️', '💰', '👛', '🏦', '💎', '📈', '🎯', '🌱'] as const;
