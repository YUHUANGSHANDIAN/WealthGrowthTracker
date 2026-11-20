import { describe, expect, it } from 'vitest';
import {
  buildMaintenanceCommands,
  DATA_MAINTENANCE_COMMAND_KEY,
  DATA_MAINTENANCE_ROUTE,
} from '../../src/features/workspace/commandPaletteItems';
import { buildMaintenanceActionsFromIssues } from '../../src/utils/maintenance';
import type { DataIssue } from '../../src/utils/dataHealth';
import {
  DATA_MAINTENANCE_TITLE,
  healthReviewBadge,
} from '../../src/features/data/dataMaintenance';
import type { HealthReviewRecord } from '../../src/domain/workspace/types';

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

  it('证据指纹变化后不再显示旧的已解决状态', () => {
    const issue = {
      id: 'classification:duplicate',
      fingerprint: 'new-fingerprint',
    } as DataIssue;
    const review = {
      issueId: issue.id,
      fingerprint: 'old-fingerprint',
      status: 'resolved',
    } as HealthReviewRecord;
    expect(healthReviewBadge(issue, review)).toEqual({
      label: '证据已变化',
      tone: 'amber',
    });
  });

  it('指纹一致时才显示现有处理状态', () => {
    const issue = {
      id: 'classification:duplicate',
      fingerprint: 'same-fingerprint',
    } as DataIssue;
    const review = {
      issueId: issue.id,
      fingerprint: issue.fingerprint,
      status: 'resolved',
    } as HealthReviewRecord;
    expect(healthReviewBadge(issue, review)).toEqual({
      label: '已解决',
      tone: 'emerald',
    });
  });
});
