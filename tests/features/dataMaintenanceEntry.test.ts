import { describe, expect, it } from 'vitest';
import {
  buildMaintenanceCommands,
  DATA_MAINTENANCE_COMMAND_KEY,
  DATA_MAINTENANCE_ROUTE,
} from '../../src/features/workspace/commandPaletteItems';
import { buildMaintenanceActionsFromIssues } from '../../src/utils/maintenance';
import type { DataIssue } from '../../src/utils/dataHealth';
import { DATA_MAINTENANCE_TITLE } from '../../src/features/data/dataMaintenance';

describe('数据维护唯一入口', () => {
  it('统一页面标题保持一个公开名称', () => {
    expect(DATA_MAINTENANCE_TITLE).toBe('数据健康与维护中心');
  });

  it('命令面板只保留一个数据维护命令，并直接打开权威数据页', () => {
    const commands = buildMaintenanceCommands();
    const dataCommands = commands.filter((item) => item.route.tab === 'data');
    expect(dataCommands).toHaveLength(1);
    expect(dataCommands[0]).toMatchObject({
      key: DATA_MAINTENANCE_COMMAND_KEY,
      label: '设置 · 数据维护',
      route: DATA_MAINTENANCE_ROUTE,
    });
    expect(new Set(commands.map((item) => item.key)).size).toBe(commands.length);
  });

  it('维护动作复用同一份健康扫描问题，不再启动第二套报告扫描', () => {
    const issues = [{
      id: 'reports:duplicate',
      title: '存在重复周期报告',
      description: '同一周期存在两份报告',
      domain: 'reports',
      severity: 'error',
    } as DataIssue];
    const actions = buildMaintenanceActionsFromIssues({
      issues,
      reports: [],
      history: [],
      channels: [],
    });
    expect(actions.map((action) => action.id)).toEqual(['dup-period']);
    expect(actions[0]).toMatchObject({ severity: 'error' });
  });
});
