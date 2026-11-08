import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../src/constants/storageKeys';
import { storageService } from '../../src/services/storage';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import { createFinanceDraftSession } from '../../src/domain/portfolio/session';
import { putAttachment } from '../../src/services/monthlyPlanning/attachments';
import {
  createClassificationEvent,
  emptyAssetClassificationState,
  parseAssetClassificationState,
  verifyAssetClassificationIntegrity,
} from '../../src/domain/assets/classification';
import {
  FULL_BACKUP_FORMAT,
  buildFullBackup,
  createStoredZip,
  parseFullBackup,
  parseStoredZip,
} from '../../src/services/export/fullBackup';

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

beforeEach(async () => {
  localStorage.clear();
  await storageService.setRaw(STORAGE_KEYS.wealthTrackerData, JSON.stringify({ channels: [], history: [] }));
  await storageService.setRaw(STORAGE_KEYS.financialReports, '[]');
});

describe('完整备份 ZIP', () => {
  it('STORE ZIP 往返读取，不依赖外部压缩库', () => {
    const data = encoder.encode('合成内容');
    const archive = createStoredZip([{ name: 'state/app-state.json', data, crc32: crc32(data) }]);
    const entries = parseStoredZip(archive);
    expect(new TextDecoder().decode(entries.get('state/app-state.json'))).toBe('合成内容');
  });

  it('拒绝路径穿越、重复条目与损坏 CRC', () => {
    expect(() => createStoredZip([{ name: '../escape', data: new Uint8Array([1]), crc32: 1 }])).toThrow('不安全路径');
    const data = encoder.encode('x');
    const archive = createStoredZip([{ name: 'data/app-state.json', data, crc32: crc32(data) }]);
    const tampered = archive.slice();
    const dataOffset = 30 + encoder.encode('data/app-state.json').length;
    tampered[dataOffset] = (tampered[dataOffset] ?? 0) ^ 0xff;
    expect(() => parseStoredZip(tampered)).toThrow(/校验|结构|ZIP/);
  });

  it('包含主状态、任务与原始附件，并可完整读取', async () => {
    const attachment = await putAttachment({
      name: '合成截图.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    });
    const task = {
      ...createFinanceDraftSession({
        planningMonth: '2026-11', taskKind: 'special-research', taskId: 'backup-research',
        timezone: 'Asia/Shanghai', today: '2026-11-01', now: '2026-11-01T08:00:00.000Z',
      }),
      documents: [{
        id: 'doc-1', relativePath: attachment.key, sha256: attachment.sha256, originalName: '合成截图.png',
        mime: 'image/png', platform: 'manual' as const, importedAt: '2026-11-01T08:00:00.000Z',
        integrity: 'ok' as const, parseState: 'manual' as const,
      }],
    };
    const monthly = { ...emptyMonthlyPlanningState(), sessions: [task] };
    await storageService.setRaw(STORAGE_KEYS.monthlyPlanning, JSON.stringify(monthly));
    const built = await buildFullBackup({
      revision: 3,
      monthlyPlanning: monthly,
      aiMetadata: JSON.stringify({ schemaVersion: 2, activeProfileId: null, profiles: [] }),
      now: new Date('2026-11-01T08:00:00.000Z'),
    });
    expect(built.filename).toMatch(/\.wgtbackup\.zip$/);
    expect(built.manifest.kind).toBe(FULL_BACKUP_FORMAT);
    expect(built.manifest.classificationSchemaVersion).toBe(1);
    expect(built.manifest.workspaceSchemaVersion).toBe(1);
    const parsed = await parseFullBackup(built.archive);
    expect(parsed.manifest.fileCount).toBe(3);
    expect(parsed.aiMetadataText).toContain('schemaVersion');
    expect(parsed.files.map((file) => file.relativePath)).toContain(
      `monthly-planning/attachments/${attachment.key.replace('monthly-attach:', '')}`,
    );
    expect(parsed.stateText).toContain('monthly_planning_state');
  });

  it('未来完整备份 schema 与敏感 AI 元数据均失败关闭', async () => {
    const payload = JSON.stringify({
      storageSchemaVersion: 1,
      revision: 1,
      payload: { wealth_tracker_data: JSON.stringify({ channels: [], history: [] }), financial_reports: '[]' },
    });
    const manifest = {
      kind: FULL_BACKUP_FORMAT,
      formatVersion: 1,
      appVersion: '2.0.0',
      createdAt: '2026-11-01T08:00:00.000Z',
      storageSchemaVersion: 1,
      monthlySchemaVersion: 3,
      fileCount: 1,
      totalBytes: encoder.encode(payload).length,
      files: [{ relativePath: 'data/app-state.json', bytes: encoder.encode(payload).length, sha256: '0'.repeat(64) }],
    };
    const manifestBytes = encoder.encode(JSON.stringify(manifest));
    const payloadBytes = encoder.encode(payload);
    const archive = createStoredZip([
      { name: 'manifest.json', data: manifestBytes, crc32: crc32(manifestBytes) },
      { name: 'data/app-state.json', data: payloadBytes, crc32: crc32(payloadBytes) },
    ]);
    await expect(parseFullBackup(archive)).rejects.toThrow('更新版本');
    await expect(buildFullBackup({
      revision: 1,
      monthlyPlanning: emptyMonthlyPlanningState(),
      aiMetadata: JSON.stringify({ apiKey: 'must-not-be-in-backup' }),
    })).rejects.toThrow('不应进入备份');
  });

  it('完整备份往返后分类事件仍可验证', async () => {
    const event = await createClassificationEvent({
      kind: 'product-classify',
      target: { type: 'channel', id: 'synthetic-channel' },
      before: null,
      after: { productKind: 'other', exposureTags: ['gold'] },
      source: 'user-confirmed',
      evidenceIds: ['doc:z', 'doc:a'],
      classifiedAt: '2026-11-01T08:00:00.000Z',
      reason: '合成备份测试',
    });
    const classification = { ...emptyAssetClassificationState(), events: [event] };
    await storageService.setRaw(STORAGE_KEYS.assetClassification, JSON.stringify(classification));
    const built = await buildFullBackup({
      revision: 4,
      monthlyPlanning: emptyMonthlyPlanningState(),
      now: new Date('2026-11-01T08:00:00.000Z'),
    });
    const parsedBackup = await parseFullBackup(built.archive);
    const envelope = JSON.parse(parsedBackup.stateText) as { payload: Record<string, string> };
    const parsedClassification = parseAssetClassificationState(
      JSON.parse(envelope.payload.asset_classification_state ?? ''),
    );
    expect(parsedClassification.events).toHaveLength(1);
    await expect(verifyAssetClassificationIntegrity(parsedClassification)).resolves.toMatchObject({ changed: false });
  });

  it('完整备份包含 1.11 工作区草稿、核对决定、修订、情景与命名视图', async () => {
    await Promise.all([
      storageService.setRaw(STORAGE_KEYS.dataRevision, '7'),
      storageService.setRaw(STORAGE_KEYS.ledgerIdentity, JSON.stringify({ schemaVersion: 1, ledgerId: 'ledger-backup', createdAt: '2026-11-01T08:00:00.000Z' })),
      storageService.setRaw(STORAGE_KEYS.workspaceDrafts, JSON.stringify({ schemaVersion: 1, drafts: [] })),
      storageService.setRaw(STORAGE_KEYS.healthReviews, JSON.stringify({ schemaVersion: 1, records: [] })),
      storageService.setRaw(STORAGE_KEYS.reportRevisions, JSON.stringify({ schemaVersion: 1, revisions: [] })),
      storageService.setRaw(STORAGE_KEYS.goalScenarios, JSON.stringify({ schemaVersion: 1, scenarios: [], comparisonIds: [] })),
      storageService.setRaw(STORAGE_KEYS.workspaceUi, JSON.stringify({ schemaVersion: 1, namedViews: [] })),
    ]);
    const built = await buildFullBackup({
      revision: 7,
      monthlyPlanning: emptyMonthlyPlanningState(),
      now: new Date('2026-11-01T08:00:00.000Z'),
    });
    const parsed = await parseFullBackup(built.archive);
    for (const key of [
      STORAGE_KEYS.dataRevision,
      STORAGE_KEYS.ledgerIdentity,
      STORAGE_KEYS.workspaceDrafts,
      STORAGE_KEYS.healthReviews,
      STORAGE_KEYS.reportRevisions,
      STORAGE_KEYS.goalScenarios,
      STORAGE_KEYS.workspaceUi,
    ]) {
      expect(parsed.stateText).toContain(key);
    }
  });

  it('完整备份中的无效工作区草稿会在恢复预览阶段失败关闭', async () => {
    await storageService.setRaw(STORAGE_KEYS.workspaceDrafts, JSON.stringify({ schemaVersion: 99, drafts: [] }));
    const built = await buildFullBackup({
      revision: 8,
      monthlyPlanning: emptyMonthlyPlanningState(),
    });
    await expect(parseFullBackup(built.archive)).rejects.toThrow('草稿状态无效');
  });
});
