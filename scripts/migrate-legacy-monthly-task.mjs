#!/usr/bin/env node
/**
 * One-time, explicit migration from a legacy formal-month task to a standalone
 * finance task. It moves, rather than copies, holdings/evidence references so
 * the authoritative ledger is not duplicated. Dry-run is the default.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const statePath = value('--state');
const sourceKey = value('--source');
const targetKey = value('--target');
const title = value('--title') ?? '初始对账';
const confirm = args.includes('--confirm');

if (!statePath || !sourceKey || !targetKey) {
  console.error('Usage: node scripts/migrate-legacy-monthly-task.mjs --state <app-state.json> --source <monthly-planning:YYYY-MM> --target <finance-task:id> [--title <title>] [--confirm]');
  process.exit(2);
}
if (!/^monthly-planning:\d{4}-(0[1-9]|1[0-2])$/.test(sourceKey)
  || !/^finance-task:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(targetKey)) {
  throw new Error('source/target key format is invalid');
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const absoluteState = resolve(statePath);
const raw = readFileSync(absoluteState, 'utf8');
const envelope = JSON.parse(raw);
if (!envelope?.payload || typeof envelope.payload.monthly_planning_state !== 'string') {
  throw new Error('state is not a storage envelope with monthly_planning_state');
}
const monthly = JSON.parse(envelope.payload.monthly_planning_state);
if (monthly.schemaVersion !== 2 || !Array.isArray(monthly.sessions)) {
  throw new Error('monthly planning schema must be migrated to v2 before this operation');
}

const sourceIndex = monthly.sessions.findIndex((task) => task.key === sourceKey);
if (sourceIndex < 0) {
  if (monthly.sessions.some((task) => task.key === targetKey)) {
    console.log(`Already migrated: ${targetKey}`);
    process.exit(0);
  }
  throw new Error(`source task not found: ${sourceKey}`);
}

const source = monthly.sessions[sourceIndex];
if (source.taskKind !== 'monthly-review') throw new Error('source task is not a monthly-review task');
const moved = structuredClone(source);
moved.key = targetKey;
moved.taskId = targetKey;
moved.taskKind = 'initial-reconciliation';
moved.title = title;
moved.linkedMonthlyTaskId = null;
moved.observations = (moved.observations ?? []).map((observation) => ({ ...observation, sessionKey: targetKey }));
if (moved.proposal) moved.proposal = { ...moved.proposal, sessionKey: targetKey };

monthly.sessions[sourceIndex] = moved;
monthly.sessions.sort((a, b) => a.key.localeCompare(b.key));
monthly.taskRevisions = (monthly.taskRevisions ?? []).map((revision) => {
  if (revision.taskId !== sourceKey) return revision;
  const snapshot = {
    ...revision.snapshot,
    key: targetKey,
    taskId: targetKey,
    taskKind: 'initial-reconciliation',
    title,
    linkedMonthlyTaskId: null,
    observations: (revision.snapshot.observations ?? []).map((observation) => ({ ...observation, sessionKey: targetKey })),
    ...(revision.snapshot.proposal ? { proposal: { ...revision.snapshot.proposal, sessionKey: targetKey } } : {}),
  };
  return { ...revision, taskId: targetKey, snapshot };
});

const changedMonthly = JSON.stringify(monthly);
const nextEnvelope = {
  ...envelope,
  revision: Number.isSafeInteger(envelope.revision) ? envelope.revision + 1 : 1,
  payload: { ...envelope.payload, monthly_planning_state: changedMonthly },
};
const summary = {
  sourceKey,
  targetKey,
  taskKind: moved.taskKind,
  documents: moved.documents?.length ?? 0,
  holdings: moved.holdings?.length ?? 0,
  observations: moved.observations?.length ?? 0,
  dryRun: !confirm,
};
console.log(JSON.stringify(summary, null, 2));
if (!confirm) process.exit(0);

const backupDir = join(dirname(absoluteState), '..', 'backups');
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
const backupPath = join(backupDir, `wealth-backup_manual_${stamp}_${randomUUID()}-pre-finance-task-migration.json`);
copyFileSync(absoluteState, backupPath);
if (sha256(readFileSync(absoluteState)) !== sha256(readFileSync(backupPath))) {
  throw new Error('pre-migration backup readback hash mismatch');
}

const tempPath = `${absoluteState}.finance-task-${process.pid}.tmp`;
writeFileSync(tempPath, `${JSON.stringify(nextEnvelope, null, 2)}\n`, 'utf8');
if (sha256(readFileSync(tempPath)) !== sha256(Buffer.from(`${JSON.stringify(nextEnvelope, null, 2)}\n`, 'utf8'))) {
  throw new Error('temporary migration file readback mismatch');
}
renameSync(tempPath, absoluteState);
console.log(JSON.stringify({ backupPath, revision: nextEnvelope.revision, stateSha256: sha256(readFileSync(absoluteState)) }, null, 2));
