import type { Route } from '../../store/navigationStore';

export const DATA_MAINTENANCE_COMMAND_KEY = 'settings:storage';
export const DATA_MAINTENANCE_ROUTE: Route = { tab: 'data' };

export interface MaintenanceCommand {
  key: string;
  label: string;
  detail: string;
  keywords: string;
  route: Route;
}

export function buildMaintenanceCommands(): MaintenanceCommand[] {
  return [{
    key: DATA_MAINTENANCE_COMMAND_KEY,
    label: '设置 · 数据维护',
    detail: '健康扫描、精准修复、导入、备份与恢复',
    keywords: '数据 健康 维护 诊断 问题 修复 备份 恢复 导入 导出 存储',
    route: DATA_MAINTENANCE_ROUTE,
  }];
}
