import type { WealthLevel } from '../types';

// 财富等级体系 —— 与旧版保持一致的名称、阈值、主题色与里程碑。
export const WEALTH_LEVELS: WealthLevel[] = [
  {
    name: '理财新手',
    minAmount: 0,
    maxAmount: 9_999,
    badge: '🌱',
    color: '#10B981',
    description: '开始理财之旅',
    theme: 'green-nature',
    milestones: [
      { percentage: 10, name: '起步阶段', emoji: '🌱' },
      { percentage: 25, name: '小有积蓄', emoji: '💰' },
      { percentage: 50, name: '半程目标', emoji: '🎯' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '储蓄达人',
    minAmount: 10_000,
    maxAmount: 49_999,
    badge: '💪',
    color: '#3B82F6',
    description: '养成储蓄好习惯',
    theme: 'blue-ocean',
    milestones: [
      { percentage: 10, name: '稳步积累', emoji: '📈' },
      { percentage: 25, name: '四分之一', emoji: '🎯' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '财富学徒',
    minAmount: 50_000,
    maxAmount: 99_999,
    badge: '📚',
    color: '#8B5CF6',
    description: '掌握理财基础知识',
    theme: 'purple-wisdom',
    milestones: [
      { percentage: 10, name: '知识积累', emoji: '📚' },
      { percentage: 25, name: '技能提升', emoji: '🎓' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '投资能手',
    minAmount: 100_000,
    maxAmount: 299_999,
    badge: '🎯',
    color: '#F59E0B',
    description: '投资技巧日益精进',
    theme: 'golden-sunset',
    milestones: [
      { percentage: 10, name: '投资起步', emoji: '🌱' },
      { percentage: 25, name: '初见成效', emoji: '📈' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '财富管家',
    minAmount: 300_000,
    maxAmount: 499_999,
    badge: '🏆',
    color: '#EF4444',
    description: '财务管理井井有条',
    theme: 'crimson-imperial',
    milestones: [
      { percentage: 10, name: '资产配置', emoji: '📊' },
      { percentage: 25, name: '稳健增长', emoji: '📈' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '投资专家',
    minAmount: 500_000,
    maxAmount: 799_999,
    badge: '👑',
    color: '#DC2626',
    description: '投资眼光独到精准',
    theme: 'red-royal',
    milestones: [
      { percentage: 10, name: '专家起步', emoji: '🎯' },
      { percentage: 25, name: '投资回报', emoji: '💰' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '财富大师',
    minAmount: 800_000,
    maxAmount: 999_999,
    badge: '💎',
    color: '#7C3AED',
    description: '财富管理炉火纯青',
    theme: 'amethyst-majesty',
    milestones: [
      { percentage: 10, name: '大师起步', emoji: '💎' },
      { percentage: 25, name: '财富增值', emoji: '📈' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
  {
    name: '百万富翁',
    minAmount: 1_000_000,
    maxAmount: Number.POSITIVE_INFINITY,
    badge: '🏰',
    color: '#FFD700',
    description: '恭喜实现百万梦想',
    theme: 'golden-legend',
    milestones: [
      { percentage: 10, name: '百万起步', emoji: '🏰' },
      { percentage: 25, name: '财富积累', emoji: '💰' },
      { percentage: 50, name: '半程节点', emoji: '🏆' },
      { percentage: 75, name: '冲刺阶段', emoji: '🚀' },
      { percentage: 90, name: '接近目标', emoji: '⭐' },
      { percentage: 100, name: '达成目标', emoji: '🎉' },
    ],
  },
];

/** 根据总资产返回当前财富等级（倒序找第一个满足 minAmount 的）。 */
export function getLevelByAmount(total: number): WealthLevel {
  const found = [...WEALTH_LEVELS].reverse().find((l) => total >= l.minAmount);
  return found ?? WEALTH_LEVELS[0]!;
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
