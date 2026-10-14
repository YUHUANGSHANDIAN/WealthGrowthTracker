import { STORAGE_KEYS } from '../../constants/storageKeys';
import { validateLedgerShape } from './validateLedger';

interface RecoveryCandidateSummary {
  channels: number;
  snapshots: number;
  reports: number;
  storageSchemaVersion: 0 | 1;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate without normalizing or rewriting raw bytes or unknown payload fields. */
export function inspectRecoveryCandidate(raw: string): RecoveryCandidateSummary {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('候选文件结构无效');
  let payload = parsed;
  let storageSchemaVersion: 0 | 1 = 0;
  if ('storageSchemaVersion' in parsed) {
    if (typeof parsed.storageSchemaVersion === 'number' && parsed.storageSchemaVersion > 1) {
      throw new Error('候选文件来自更新版本，当前版本禁止恢复');
    }
    if (parsed.storageSchemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) ||
        (parsed.revision as number) < 0 || !isRecord(parsed.payload)) throw new Error('候选文件 Envelope 无效');
    payload = parsed.payload;
    storageSchemaVersion = 1;
  }
  if (Object.values(payload).some(value => typeof value !== 'string')) throw new Error('候选文件存储值无效');
  const ledgerRaw = payload[STORAGE_KEYS.wealthTrackerData];
  if (typeof ledgerRaw !== 'string') throw new Error('候选文件缺少资产主数据，不能恢复');
  const ledger: unknown = JSON.parse(ledgerRaw);
  if (ledger === null) throw new Error('候选文件资产主数据为空，不能恢复');
  const reportsRaw = payload[STORAGE_KEYS.financialReports];
  const reports: unknown = typeof reportsRaw === 'string' ? JSON.parse(reportsRaw) : [];
  validateLedgerShape(ledger, reports);
  const counts = ledger as { channels: unknown[]; history: unknown[] };
  return {
    channels: counts.channels.length,
    snapshots: counts.history.length,
    reports: Array.isArray(reports) ? reports.length : 0,
    storageSchemaVersion,
  };
}
