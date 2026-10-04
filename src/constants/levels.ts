import type { LevelTheme, WealthLevel, WealthLevelDefinition, WealthTheme } from '../types';

/**
 * 财富等级体系 —— 与旧版保持一致的名称、阈值、主题色与里程碑。
 *
 * v1.3 架构：等级逻辑（WealthLevelDefinition）与视觉主题（WealthTheme）解耦，
 * 组件只消费 CSS Variables。高财富等级不再大面积使用 crimson/red，
 * 因为金融 UI 中红色主要表示「下降 / 风险 / 错误」。
 */

const MILESTONES = (names: string[]): WealthLevel['milestones'] => [
  { percentage: 10, name: names[0]!, emoji: '🌱' },
  { percentage: 25, name: names[1]!, emoji: '💰' },
  { percentage: 50, name: names[2]!, emoji: '🏆' },
  { percentage: 75, name: names[3]!, emoji: '🚀' },
  { percentage: 90, name: names[4]!, emoji: '⭐' },
  { percentage: 100, name: names[5]!, emoji: '🎉' },
];

/** 由显式 token 派生 v1.3 扩展 token（抬升表面/次要文字/庆祝/背景母题/未来暗色）。 */
function theme(base: LevelTheme): LevelTheme {
  return {
    ...base,
    surfaceElevated: base.surfaceElevated ?? base.surfaceSoft,
    muted: base.muted ?? '#64748b',
    hero: base.hero ?? base.heroGradient,
    celebration: base.celebration ?? base.primary,
    backgroundMotif:
      base.backgroundMotif ?? `radial-gradient(circle at 18% 18%, ${base.secondary}26 0%, transparent 55%)`,
    dark: base.dark ?? {
      primary: base.secondary,
      surface: '#0f172a',
      surfaceElevated: '#1e293b',
      border: '#334155',
      text: '#e2e8f0',
    },
  };
}

/** 视觉主题包（独立于等级逻辑）。 */
export const WEALTH_THEMES: WealthTheme[] = [
  {
    id: 'green-nature',
    tokens: theme({
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
    }),
  },
  {
    id: 'blue-ocean',
    tokens: theme({
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
    }),
  },
  {
    id: 'purple-wisdom',
    tokens: theme({
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
    }),
  },
  {
    id: 'golden-sunset',
    tokens: theme({
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
    }),
  },
  {
    id: 'bronze-gold',
    tokens: theme({
      primary: '#B45309',
      secondary: '#D97706',
      accent: '#D4AF37',
      surface: '#FFF7ED',
      surfaceSoft: '#FFFDFA',
      textOnPrimary: '#FFFFFF',
      border: '#FDE68A',
      glow: 'rgba(180,83,9,0.30)',
      progressGradient: 'linear-gradient(90deg,#D97706,#D4AF37)',
      heroGradient: 'linear-gradient(135deg,#FEF3C7 0%,#FDE68A 55%,#FED7AA 100%)',
      particleColor: '#FCD34D',
      chartAccent: '#B45309',
    }),
  },
  {
    id: 'navy-gold',
    tokens: theme({
      primary: '#1E3A8A',
      secondary: '#3B82F6',
      accent: '#D4AF37',
      surface: '#EFF6FF',
      surfaceSoft: '#F8FAFF',
      textOnPrimary: '#FFFFFF',
      border: '#BFDBFE',
      glow: 'rgba(30,58,138,0.35)',
      progressGradient: 'linear-gradient(90deg,#3B82F6,#D4AF37)',
      heroGradient: 'linear-gradient(135deg,#DBEAFE 0%,#BFDBFE 55%,#FEF3C7 100%)',
      particleColor: '#93C5FD',
      chartAccent: '#1E3A8A',
    }),
  },
  {
    id: 'amethyst-majesty',
    tokens: theme({
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
    }),
  },
  {
    id: 'golden-legend',
    tokens: theme({
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
    }),
  },
];

/** 等级逻辑定义（阈值/名称/里程碑，独立于视觉主题）。 */
export const WEALTH_LEVEL_DEFINITIONS: WealthLevelDefinition[] = [
  { id: 'novice', name: '理财新手', minAmount: 0, maxAmount: 9_999, badge: '🌱', description: '开始理财之旅', themeId: 'green-nature', milestones: MILESTONES(['起步阶段', '小有积蓄', '半程目标', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'saver', name: '储蓄达人', minAmount: 10_000, maxAmount: 49_999, badge: '💪', description: '养成储蓄好习惯', themeId: 'blue-ocean', milestones: MILESTONES(['稳步积累', '四分之一', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'apprentice', name: '财富学徒', minAmount: 50_000, maxAmount: 99_999, badge: '📚', description: '掌握理财基础知识', themeId: 'purple-wisdom', milestones: MILESTONES(['知识积累', '技能提升', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'investor', name: '投资能手', minAmount: 100_000, maxAmount: 299_999, badge: '🎯', description: '投资技巧日益精进', themeId: 'golden-sunset', milestones: MILESTONES(['投资起步', '初见成效', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'steward', name: '财富管家', minAmount: 300_000, maxAmount: 499_999, badge: '🏆', description: '财务管理井井有条', themeId: 'bronze-gold', milestones: MILESTONES(['资产配置', '稳健增长', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'expert', name: '投资专家', minAmount: 500_000, maxAmount: 799_999, badge: '👑', description: '投资眼光独到精准', themeId: 'navy-gold', milestones: MILESTONES(['专家起步', '投资回报', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'master', name: '财富大师', minAmount: 800_000, maxAmount: 999_999, badge: '💎', description: '财富管理炉火纯青', themeId: 'amethyst-majesty', milestones: MILESTONES(['大师起步', '财富增值', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
  { id: 'millionaire', name: '百万富翁', minAmount: 1_000_000, maxAmount: Number.POSITIVE_INFINITY, badge: '🏰', description: '恭喜实现百万梦想', themeId: 'golden-legend', milestones: MILESTONES(['百万起步', '财富积累', '半程节点', '冲刺阶段', '接近目标', '达成目标']) },
];

function themeById(id: string): LevelTheme {
  return WEALTH_THEMES.find((t) => t.id === id)?.tokens ?? WEALTH_THEMES[0]!.tokens;
}

/** 组合等级（逻辑 + 主题），保持旧 API 兼容（level.tokens / level.theme / level.color）。 */
export const WEALTH_LEVELS: WealthLevel[] = WEALTH_LEVEL_DEFINITIONS.map((def) => {
  const tokens = themeById(def.themeId);
  return {
    name: def.name,
    minAmount: def.minAmount,
    maxAmount: def.maxAmount,
    badge: def.badge,
    color: tokens.primary,
    description: def.description,
    theme: def.themeId,
    tokens,
    milestones: def.milestones,
  };
});

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

/** 按等级 name 查找（用于成就回推）。 */
export function getLevelByName(name: string): WealthLevel | undefined {
  return WEALTH_LEVELS.find((l) => l.name === name);
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
