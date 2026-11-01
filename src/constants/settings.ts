export const SETTINGS_SECTIONS = [
  { id: 'profile', label: '个人资料', description: '昵称、头像、签名与默认时区', keywords: '资料 个人 昵称 头像 签名 时区 timezone' },
  { id: 'appearance', label: '外观偏好', description: '主题模式、财富主题与减少动画', keywords: '外观 显示 无障碍 深色 浅色 系统 主题 动画 motion' },
  { id: 'records', label: '记录规则', description: '快照、周期报告与记录规则', keywords: '记录 报告 历史 快照 周报 月报 年报 日期 周期' },
  { id: 'ai', label: '模型连接', description: '连接切换、启停状态与数据授权边界', keywords: 'AI 模型 连接 订阅 OpenAI Copilot API key 密钥 授权' },
  { id: 'storage', label: '数据维护', description: '导入、导出、备份、恢复与存储位置', keywords: '数据 存储 备份 恢复 导入 导出 目录 迁移' },
  { id: 'account', label: '应用锁', description: '本地 PIN 或密码锁与安全限制', keywords: '账号 账户 安全 PIN 密码 加密 应用锁' },
  { id: 'privacy', label: '隐私说明', description: '本地数据、联网行为、导出与日志说明', keywords: '隐私 金额 隐藏 本地 联网 分享 日志' },
  { id: 'update', label: '版本更新', description: '主动检查 GitHub Release 与下载安装包', keywords: '版本 更新 下载 安装 Release GitHub' },
  { id: 'about', label: '关于', description: '应用版本、平台与存储后端', keywords: '关于 应用 版本 平台 架构 Schema' },
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
