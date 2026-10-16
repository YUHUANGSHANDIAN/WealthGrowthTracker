import React, { useEffect, useMemo, useRef, useState } from 'react';
import { beginLedgerMaintenance, useAppStore } from '../../store/appStore';
import { Card, Button, Badge } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { storageService, getDocumentsDir, getDefaultDataDir, openPathInSystem } from '../../services/storage';
import { readStorageConfig, writeStorageConfig, migrateDataRoot, type DataRootConfig } from '../../services/storage/fs';
import { TextField } from '../../components/ui/form';
import { validateDataRootMigration } from '../../services/storage/migrate';
import { StorageRootSwitchError, switchStorageRootConfig } from '../../services/storage/rootSwitch';
import { restoreWithReadback } from '../../services/storage/restore';
import { parseBackup } from '../../services/export';
import {
  MAX_ARCHIVE_BYTES, buildAttachmentArchive, countExistingAttachments, importAttachmentArchive, parseAttachmentArchive,
  type AttachmentArchive,
} from '../../services/monthlyPlanning/attachmentArchive';
import { downloadCSV } from '../../components/charts/export';
import { buildChannelsCsv, buildHistoryCsv } from '../../utils/dataCsv';
import { checkDataHealth, checkReportHealth, checkGoalHealth, checkAchievementHealth, checkLotteryHealth, domainLabel, type DataIssue, type HealthDomain } from '../../utils/dataHealth';
import { previewMerge } from '../../utils/mergeData';
import { platformCapabilities } from '../../utils/platform';
import { useNavigationStore } from '../../store/navigationStore';
import { planBackfill, monthlyCoverageByYear } from '../reports/backfill';
import { buildAnonymousDiagnostic } from '../../utils/anonymousDiagnostic';
import { buildMaintenanceActions, type MaintenanceAction } from '../../utils/maintenance';
import { saveTextFile, backupFilename } from '../../services/export/download';
import { AIActionButton } from '../ai/AIActionButton';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function DataPanel() {
  const { exportData, importData, applyDataFixes, pushToast, hydrate, runMonthlyBackfill } = useAppStore();
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const reports = useAppStore((s) => s.reports);
  const goals = useAppStore((s) => s.goals);
  const primaryGoalId = useAppStore((s) => s.primaryGoalId);
  const levelAchievements = useAppStore((s) => s.levelAchievements);
  const lottery = useAppStore((s) => s.lottery);
  const navigate = useNavigationStore((s) => s.navigate);

  const [preview, setPreview] = useState<{ text: string; channels: number; history: number; reports: number; merge: ReturnType<typeof previewMerge> } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const archiveFileRef = useRef<HTMLInputElement>(null);
  const [archivePreview, setArchivePreview] = useState<
    { archive: AttachmentArchive; existing: number; missing: number; bytes: number } | null
  >(null);

  const adapterName = storageService.getAdapterName();
  const isDesktop = adapterName === 'desktop';
  const canOpenFolder = platformCapabilities().canOpenFolder;

  const [dataPath, setDataPath] = useState('');
  const [backups, setBackups] = useState<string[]>([]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backfillPreviewOpen, setBackfillPreviewOpen] = useState(false);
  const [backfillBaseRevision, setBackfillBaseRevision] = useState<number | null>(null);
  const [dataRootMode, setDataRootMode] = useState<'default' | 'custom'>('default');
  const [storageModalOpen, setStorageModalOpen] = useState(false);

  const coverageByYear = useMemo(() => monthlyCoverageByYear(reports, history), [reports, history]);
  const backfillPlan = useMemo(() => planBackfill(reports, history), [reports, history]);
  const maintenanceActions = useMemo(() => buildMaintenanceActions({ reports, history, channels, hasCustomStorage: dataRootMode === 'custom' }), [reports, history, channels, dataRootMode]);

  const health = useMemo(() => {
    const base = checkDataHealth(channels, history);
    const report = checkReportHealth(reports);
    const goal = checkGoalHealth(goals, primaryGoalId);
    const achievement = checkAchievementHealth(levelAchievements);
    const lotteryHealth = checkLotteryHealth(lottery);
    const issues = [...base.issues, ...report, ...goal, ...achievement, ...lotteryHealth];
    return { ...base, issues, ok: issues.length === 0 };
  }, [channels, history, reports, goals, primaryGoalId, levelAchievements, lottery]);
  const sortedHistory = useMemo(() => [...history].sort((a, b) => (a.date < b.date ? -1 : 1)), [history]);

  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    void (async () => {
      try {
        const dir = await getDocumentsDir();
        if (active && dir) setDataPath(dir);
        const cfg = await readStorageConfig();
        if (active && cfg) setDataRootMode(cfg.dataRootMode);
      } catch {
        if (active) pushToast('无法读取存储位置，请检查配置与权限', 'error');
      }
    })();
    return () => { active = false; };
  }, [isDesktop, pushToast]);

  async function refreshBackups() {
    const mgr = storageService.getDesktopManager();
    try {
      if (mgr) setBackups(await mgr.listBackups());
      return true;
    } catch {
      pushToast('无法读取备份列表，请检查目录权限', 'error');
      return false;
    }
  }

  async function handleExport() {
    try { await exportData(); } catch { pushToast('导出失败，请检查目标位置与权限', 'error'); }
  }

  /** 含附件的单文件归档：把月度会话引用的附件内容与索引清单一起导出。 */
  async function handleExportAttachments() {
    let release: (() => void) | undefined;
    setBusy(true);
    try {
      release = beginLedgerMaintenance('正在导出含附件备份');
      const { monthlyPlanning } = useAppStore.getState();
      const result = await buildAttachmentArchive(monthlyPlanning, new Date().toISOString());
      if (!result.attachmentCount) {
        pushToast('没有需要导出的附件：月度会话尚未引用任何资料文件', 'error');
        return;
      }
      await saveTextFile(backupFilename('wealth_tracker_attachments'), result.text);
      pushToast(`已导出 ${result.attachmentCount} 个附件（${(result.totalBytes / 1024 / 1024).toFixed(1)} MiB）`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导出含附件备份失败', 'error');
    } finally {
      release?.();
      setBusy(false);
    }
  }

  async function onArchiveChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error(`含附件备份超过 ${(MAX_ARCHIVE_BYTES / 1024 / 1024).toFixed(0)} MiB 上限`);
      const text = await file.text();
      const parsed = parseAttachmentArchive(text);
      if (!parsed.ok) { pushToast(parsed.error, 'error'); return; }
      const { existing, missing } = await countExistingAttachments(parsed.archive);
      setArchivePreview({
        archive: parsed.archive, existing, missing,
        bytes: parsed.archive.attachments.reduce((sum, entry) => sum + entry.bytes, 0),
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '无法读取含附件备份', 'error');
    } finally {
      e.target.value = '';
    }
  }

  async function doImportAttachments() {
    if (!archivePreview) return;
    let release: (() => void) | undefined;
    setImporting(true);
    try {
      release = beginLedgerMaintenance('正在导入附件备份');
      const result = await importAttachmentArchive(archivePreview.archive);
      const detail = result.failures.length ? `；失败 ${result.failures.length} 项：${result.failures.map((item) => item.reason).join('；')}` : '';
      pushToast(`附件导入完成：新增 ${result.imported}、跳过 ${result.skipped}${detail}`, result.failed ? 'error' : 'success');
      if (!result.failed) setArchivePreview(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导入附件失败', 'error');
    } finally {
      release?.();
      setImporting(false);
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('JSON 文件超过 32 MiB 限制');
      const text = await file.text();
      const result = parseBackup(text);
      if (!result.ok) {
        pushToast(result.error, 'error');
      } else {
        const merge = previewMerge(
          { channels, history, reports },
          { channels: result.data.channels, history: result.data.history, reports: result.data.reports },
        );
        setPreview({ text, channels: result.data.channels.length, history: result.data.history.length, reports: result.data.reports.length, merge });
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '无法读取导入文件', 'error');
    } finally {
      e.target.value = '';
    }
  }

  async function doImport(mode: 'replace' | 'merge') {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await importData(preview.text, mode);
      if (res.ok) setPreview(null);
      pushToast(res.message, res.ok ? 'success' : 'error');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导入失败，请检查保存状态', 'error');
    } finally { setImporting(false); }
  }

  async function doManualBackup() {
    const mgr = storageService.getDesktopManager();
    if (!mgr) return;
    setBusy(true);
    let release: (() => void) | undefined;
    try {
      release = beginLedgerMaintenance('正在创建备份');
      await storageService.flush();
      const name = await mgr.backupNow(true);
      pushToast(name ? `已创建手动备份 ${name}` : '尚无可备份主文件', name ? 'success' : 'error');
      await refreshBackups();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '创建备份失败', 'error');
    } finally { release?.(); setBusy(false); }
  }

  async function doRestore() {
    if (!confirmRestore) return;
    const mgr = storageService.getDesktopManager();
    if (!mgr) return;
    setBusy(true);
    let release: (() => void) | undefined;
    try {
      release = beginLedgerMaintenance('正在恢复备份');
      await restoreWithReadback({
        drain: () => storageService.flush(), pause: () => storageService.pauseWrites(),
        resume: () => storageService.resumeWrites(), restore: () => mgr.restoreBackup(confirmRestore),
        reload: () => storageService.reload(), hydrate,
        enterRecovery: message => useAppStore.setState({ hydrated: false, recoveryError: message, saveStatus: 'error' }),
      });
      pushToast('已从备份恢复，数据已刷新', 'success');
    } catch (err) {
      console.error('[data] 恢复失败:', err);
      pushToast(errorMessage(err, '恢复失败，请检查恢复界面'), 'error');
    } finally {
      release?.();
      setBusy(false);
      setConfirmRestore(null);
      setRestoreOpen(false);
    }
  }

  async function doFix() {
    try {
      const res = await applyDataFixes();
      pushToast(res.fixed > 0 ? `已修复 ${res.fixed} 类问题` : '无需修复', 'success');
    } catch (error) { pushToast(errorMessage(error, '修复失败，请检查保存状态'), 'error'); }
  }

  function exportCsv(kind: 'channels' | 'history') {
    if (kind === 'channels') {
      const { header, rows } = buildChannelsCsv(channels);
      downloadCSV('wealth_channels.csv', header, rows);
    } else {
      const { header, rows } = buildHistoryCsv(history);
      downloadCSV('wealth_history.csv', header, rows);
    }
  }

  async function exportAnonymousDiagnostic() {
    const diag = buildAnonymousDiagnostic({
      channels,
      history,
      reports,
      goals,
      levelAchievements,
      lottery,
      healthIssueTypes: health.issues.map((i) => i.domain),
      platform: platformCapabilities().platform,
      storageBackend: adapterName,
    });
    await saveTextFile(backupFilename('anonymous_diagnostic'), JSON.stringify(diag, null, 2));
    pushToast('已导出匿名诊断包（不含金额/名称/交易等敏感信息）', 'success');
  }

  async function doMigrateDataRoot(target: string, mode: 'custom' | 'default'): Promise<string | null> {
    const validation = validateDataRootMigration(dataPath, target);
    if (!validation.ok) return validation.reason ?? '路径非法';
    let recovered = true;
    let release: (() => void) | undefined;
    try {
      release = beginLedgerMaintenance('正在迁移数据目录');
      const previousConfig = await readStorageConfig();
      if (!previousConfig) throw new Error('无法读取原存储配置');
      await storageService.flush();
      storageService.pauseWrites();
      const mgr = storageService.getDesktopManager();
      if (mgr) await mgr.backupNow(true); // 迁移前备份，随数据树一起复制
      await migrateDataRoot(dataPath, target);
      const nextConfig: DataRootConfig = {
        dataRootMode: mode,
        ...(mode === 'custom' ? { customDataRoot: target } : {}),
        updatedAt: new Date().toISOString(),
      };
      await switchStorageRootConfig(previousConfig, nextConfig, {
        writeConfig: writeStorageConfig,
        verifyCurrentRoot: async () => {
          await storageService.reload();
          // Hydration may perform upgrade writes only after the root reads successfully.
          storageService.resumeWrites();
          await hydrate();
        },
      });
      setDataPath(target);
      setDataRootMode(mode);
      return null; // 成功
    } catch (err) {
      console.error('[storage] 迁移失败:', err);
      if (err instanceof StorageRootSwitchError && !err.restored) {
        recovered = false;
        storageService.pauseWrites();
        useAppStore.setState({ hydrated: false, recoveryError: '迁移读回与配置恢复均失败。请保留新旧目录并修复存储配置后重新读取。' });
        return '迁移读回与配置恢复均失败，请停止编辑，并保留新旧目录用于恢复。';
      }
      return `迁移失败：${String(err)}。新旧目录均保留。`;
    } finally {
      if (recovered && !useAppStore.getState().recoveryError) storageService.resumeWrites();
      release?.();
    }
  }

  return (
    <div className="space-y-4">
      {/* 数据概览 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">数据概览</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <ClickableStat label="父渠道" value={String(channels.length)} onClick={() => navigate({ tab: 'assets' })} />
          <ClickableStat label="历史记录" value={String(history.length)} onClick={() => navigate({ tab: 'history' })} />
          <ClickableStat label="财务报告" value={String(reports.length)} onClick={() => navigate({ tab: 'reports' })} />
          <ClickableStat label="财富目标" value={String(goals.length)} onClick={() => navigate({ tab: 'goals' })} />
          <ClickableStat label="彩票交易" value={String(lottery.transactions.length)} onClick={() => navigate({ tab: 'lottery' })} />
          <Stat label="备份数" value={backups.length ? String(backups.length) : '—'} />
          <Stat label="最早历史" value={sortedHistory[0]?.date ?? '—'} />
          <Stat label="最新历史" value={sortedHistory[sortedHistory.length - 1]?.date ?? '—'} />
        </div>
        {isDesktop && dataPath && <p className="mt-3 text-xs text-slate-500 font-mono break-all">数据目录：{dataPath}</p>}
      </Card>

      {/* 数据健康与维护中心（v1.6：动态 Maintenance Action + 问题详情） */}
      <MaintenanceActions actions={maintenanceActions} />
      <DataHealthCenter issues={health.issues} onFixAll={doFix} busy={busy} />

      {/* 活动日志 */}
      <ActivityLogCard />

      {/* 数据维护：报告覆盖 + 历史补月报 + 匿名诊断 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">🧰 数据维护</h2>
        <div className="space-y-3">
          <div>
            <div className="text-sm text-slate-600 mb-1">报告覆盖情况</div>
            {coverageByYear.length === 0 ? (
              <p className="text-xs text-slate-400">暂无历史数据可统计。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {coverageByYear.map((y) => (
                  <span key={y.year} className="text-xs bg-slate-50 rounded-lg px-2 py-1">
                    {y.year}：月报 {y.covered} / {y.total}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { setBackfillBaseRevision(useAppStore.getState().dataRevision); setBackfillPreviewOpen(true); }}>📅 预览补生成缺失月报</Button>
            <AIActionButton task="data-health-explanation">AI 解释覆盖指标</AIActionButton>
            <Button size="sm" variant="outline" onClick={() => void exportAnonymousDiagnostic()}>🩺 导出匿名诊断</Button>
          </div>
        </div>
      </Card>


      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导出数据</h2>
        <p className="text-sm text-slate-500 mb-3">导出 JSON 全量备份，或导出 CSV 用于 Excel / OriginPro / Python 分析。含附件备份会把月度会话引用的资料文件一起打进单个 JSON。</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport}>⬇ 导出 JSON 备份</Button>
          <Button variant="outline" onClick={() => void handleExportAttachments()} disabled={busy}>🗂 导出含附件完整备份</Button>
          <Button variant="outline" onClick={() => exportCsv('channels')}>📊 渠道资产 CSV</Button>
          <Button variant="outline" onClick={() => exportCsv('history')}>📈 历史记录 CSV</Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导入数据</h2>
        <p className="text-sm text-slate-500 mb-3">从 JSON 备份恢复，支持覆盖或合并（ID/日期优先，冲突保留当前）。含附件备份只恢复附件内容，不创建会话——结构化数据请另用 JSON 备份恢复。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>⬆ 选择 JSON 文件导入</Button>
          <Button variant="outline" onClick={() => archiveFileRef.current?.click()} disabled={importing}>🗂 导入含附件备份</Button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFileChosen} className="hidden" aria-label="选择导入文件" />
        <input ref={archiveFileRef} type="file" accept=".json,application/json" onChange={onArchiveChosen} className="hidden" aria-label="选择含附件备份文件" />
      </Card>

      {canOpenFolder && (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-800 mb-2">本地数据与备份</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void openPathInSystem('')}>📂 打开数据文件夹</Button>
            <Button size="sm" variant="outline" onClick={() => void openPathInSystem('backups')}>🗄 打开备份文件夹</Button>
            <Button size="sm" variant="outline" onClick={() => void doManualBackup()} disabled={busy}>💾 立即备份</Button>
            <Button size="sm" variant="outline" onClick={() => { void refreshBackups().then(ok => { if (ok) setRestoreOpen(true); }); }} disabled={busy}>♻ 从备份恢复</Button>
          </div>
        </Card>
      )}

      {canOpenFolder && (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-800 mb-2">📁 数据存放位置</h2>
          <p className="text-sm text-slate-500 mb-1 break-all">当前：<span className="font-mono text-xs text-slate-700">{dataPath || '—'}</span></p>
          <p className="text-xs text-slate-400 mb-3">模式：{dataRootMode === 'custom' ? '自定义目录' : '默认目录'} · Storage Backend：{adapterName}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setStorageModalOpen(true)}>📁 更改位置</Button>
            {dataRootMode === 'custom' && (
              <Button size="sm" variant="outline" onClick={() => { void (async () => { const d = await getDefaultDataDir(); if (d) { const err = await doMigrateDataRoot(d, 'default'); if (err) pushToast(err, 'error'); else pushToast('已恢复默认位置', 'success'); } })(); }}>↩ 恢复默认位置</Button>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">存储与隐私</h2>
        <p className="text-sm text-slate-600">你的所有资产数据默认只保存在<strong>你自己的电脑本地</strong>，不会上传到任何服务器。卸载应用不会删除「我的文档」中的财富数据。</p>
      </Card>

      {/* 导入预览确认 */}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="确认导入数据"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={importing}>取消</Button>
            <Button variant="outline" onClick={() => doImport('merge')} disabled={importing}>合并导入</Button>
            <Button variant="danger" onClick={() => doImport('replace')} disabled={importing}>{importing ? '导入中…' : '覆盖导入'}</Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">渠道</div>
                <div className="font-semibold tabular">{preview.merge.channels.added} 新增 / {preview.merge.channels.conflict} 冲突</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">历史</div>
                <div className="font-semibold tabular">{preview.merge.history.added} 新增 / {preview.merge.history.conflict} 冲突</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">报告</div>
                <div className="font-semibold tabular">{preview.merge.reports.added} 新增</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">合并导入：新数据加入，冲突保留当前数据。覆盖导入：完全替换当前数据。</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              确认导入时会先保存当前数据；桌面版随后创建并验证备份，备份失败会中止导入。
            </div>
          </div>
        )}
      </Modal>

      {/* 从备份恢复 */}
      <Modal
        open={archivePreview !== null}
        onClose={() => setArchivePreview(null)}
        title="确认导入含附件备份"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setArchivePreview(null)} disabled={importing}>取消</Button>
            <Button onClick={() => void doImportAttachments()} disabled={importing}>{importing ? '导入中…' : '导入附件'}</Button>
          </>
        }
      >
        {archivePreview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">附件</div>
                <div className="font-semibold tabular">{archivePreview.archive.attachments.length} 个</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">总大小</div>
                <div className="font-semibold tabular">{(archivePreview.bytes / 1024 / 1024).toFixed(1)} MiB</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">已存在 / 待写入</div>
                <div className="font-semibold tabular">{archivePreview.existing} / {archivePreview.missing}</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              导出时间：{archivePreview.archive.exportedAt} · 导出应用版本：{archivePreview.archive.appVersion}
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              导入前会逐项校验哈希，任何一项不符就整批拒绝写入；已存在且内容一致的附件会跳过，不会覆盖既有附件。
              归档只恢复附件内容，不创建月度会话——结构化数据请用 JSON 备份恢复。
            </div>
          </div>
        )}
      </Modal>

      <Modal open={restoreOpen} onClose={() => setRestoreOpen(false)} title="从备份恢复" size="md">
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {backups.length === 0 ? <p className="text-sm text-slate-400">暂无备份文件。</p> : backups.map((b) => (
            <div key={b} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
              <span className="flex-1 text-sm text-slate-700 font-mono text-xs break-all">{b}</span>
              <Button size="sm" variant="outline" onClick={() => setConfirmRestore(b)}>恢复</Button>
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRestore !== null}
        title="确认恢复备份"
        message={`确定用备份「${confirmRestore ?? ''}」替换当前数据吗？恢复前会排空写入并保留原主文件；完成后读回验证。`}
        confirmLabel="恢复"
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => void doRestore()}
      />

      <BackfillPreviewModal
        open={backfillPreviewOpen}
        plan={backfillPlan}
        onClose={() => setBackfillPreviewOpen(false)}
        onRun={() => {
          void (async () => {
            try {
              const r = await runMonthlyBackfill(backfillBaseRevision ?? useAppStore.getState().dataRevision);
              setBackfillPreviewOpen(false);
              pushToast(`补生成 ${r.created.length} 份、修复 ${r.repaired.length} 份历史月报`, 'success');
            } catch (error) {
              pushToast(error instanceof Error ? error.message : '月报补全失败，请重试', 'error');
            }
          })();
        }}
      />

      <StorageLocationModal
        open={storageModalOpen}
        currentRoot={dataPath}
        onClose={() => setStorageModalOpen(false)}
        onMigrate={async (target) => {
          const err = await doMigrateDataRoot(target, 'custom');
          if (err) return err;
          setStorageModalOpen(false);
          pushToast('数据目录迁移成功', 'success');
          return null;
        }}
      />
    </div>
  );
}

function BackfillPreviewModal({ open, plan, onClose, onRun }: {
  open: boolean;
  plan: ReturnType<typeof planBackfill>;
  onClose: () => void;
  onRun: () => void;
}) {
  const createCount = plan.filter((p) => p.action === 'create').length;
  const repairCount = plan.filter((p) => p.action === 'repair').length;
  const skipCount = plan.filter((p) => p.action === 'skip').length;
  return (
    <Modal open={open} onClose={onClose} title="补生成缺失月报（预览）" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={onRun} disabled={createCount === 0 && repairCount === 0}>执行补生成</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">将为缺失的历史月份生成月度报告（dataAsOf = 该月最后有效记录日期，绝不虚构月末值）。</p>
        <div className="flex gap-3 text-sm">
          <span className="text-emerald-600">将创建 {createCount}</span>
          <span className="text-blue-600">将修复 {repairCount}</span>
          <span className="text-slate-400">跳过 {skipCount}</span>
        </div>
        <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50 text-xs">
          {plan.map((p) => (
            <div key={p.periodKey} className="flex items-center gap-2 px-3 py-2">
              <span className="w-24 tabular text-slate-500 shrink-0">{p.month}</span>
              <span className="w-24 tabular text-slate-400 shrink-0">{p.lastDataDate ?? '—'}</span>
              <span className={`shrink-0 ${p.action === 'create' ? 'text-emerald-600' : p.action === 'repair' ? 'text-blue-600' : 'text-slate-400'}`}>
                {p.action === 'create' ? 'Create' : p.action === 'repair' ? 'Repair' : 'Skip'}
              </span>
              <span className="flex-1 text-slate-400 truncate">{p.reason}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function StorageLocationModal({ open, currentRoot, onClose, onMigrate }: {
  open: boolean;
  currentRoot: string;
  onClose: () => void;
  onMigrate: (target: string) => Promise<string | null>;
}) {
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function submit() {
    const validation = validateDataRootMigration(currentRoot, target);
    if (!validation.ok) { setError(validation.reason ?? '路径非法'); return; }
    setError('');
    setBusy(true);
    void onMigrate(target.trim()).then((err) => {
      setBusy(false);
      if (err) setError(err);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="更改数据存放位置" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={busy}>{busy ? '迁移中…' : '迁移到此位置'}</Button>
      </>}>
      <div className="space-y-4">
        <div>
          <div className="text-xs text-slate-400 mb-1">当前数据位置</div>
          <div className="text-sm font-mono text-slate-700 break-all">{currentRoot || '—'}</div>
        </div>
        <TextField label="新数据目录（绝对路径）" value={target} onChange={(e) => setTarget(e.target.value)} error={error} placeholder="例如：D:\\WealthData" autoFocus />
        <p className="text-xs text-slate-400">
          迁移会复制整个数据目录树并读回校验。旧目录保留，确认新位置可用后请手动清理。目标目录应为空或尚不存在，且父目录已存在。
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          ⚠️ 迁移前会先创建备份并随数据一起复制到新位置。请勿在迁移过程中关闭应用。
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg py-2 px-1">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-700 tabular break-all">{value}</div>
    </div>
  );
}

function ClickableStat({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-slate-50 hover:bg-emerald-50 rounded-lg py-2 px-1 text-left transition-colors" title={`前往 ${label}`}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-700 tabular break-all">{value} ›</div>
    </button>
  );
}

function MaintenanceActions({ actions }: { actions: MaintenanceAction[] }) {
  if (actions.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-800">🩺 数据健康与维护中心</h2>
          <Badge tone="emerald">✅ 无需处理</Badge>
        </div>
        <p className="text-sm text-slate-500">当前没有需要执行的数据维护任务。</p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-slate-800">🩺 数据健康与维护中心</h2>
        <Badge tone="amber">{actions.length} 项待处理</Badge>
      </div>
      <div className="space-y-2">
        {actions.map((a) => (
          <div key={a.id} className="flex items-start gap-2 px-3 py-2 rounded-lg border border-slate-100">
            <span className={a.severity === 'error' ? 'text-red-500' : a.severity === 'warning' ? 'text-amber-500' : 'text-slate-400'} aria-hidden>{a.severity === 'error' ? '✖' : '⚠'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-700">{a.title}</div>
              <div className="text-xs text-slate-400">{a.description}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const DOMAIN_ICONS: Record<HealthDomain, string> = {
  assets: '💰', history: '🕰️', reports: '📑', goals: '🎯', levels: '🏅', lottery: '🎟️', storage: '🗄️', settings: '⚙️',
  monthly: '📅',
};

function issueNavigateTarget(i: DataIssue): { tab: import('../../store/navigationStore').TabId; extra?: Record<string, string> } | null {
  switch (i.domain) {
    case 'assets': return { tab: 'assets', ...(i.entityId ? { extra: { channelId: i.entityId } } : {}) };
    case 'history': return { tab: 'history', ...(i.entityId ? { extra: { historyDate: i.entityId } } : {}) };
    case 'reports': return { tab: 'reports', ...(i.entityId ? { extra: { reportId: i.entityId } } : {}) };
    case 'goals': return { tab: 'goals' };
    case 'lottery': return { tab: 'lottery' };
    case 'levels': return { tab: 'assets' };
    default: return null;
  }
}

function DataHealthCenter({ issues, onFixAll, busy }: { issues: DataIssue[]; onFixAll: () => void; busy: boolean }) {
  const navigate = useNavigationStore((s) => s.navigate);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const visible = issues.filter((i) => !ignored.has(i.id));
  const grouped = useMemo(() => {
    const m = new Map<HealthDomain, DataIssue[]>();
    for (const i of visible) {
      const arr = m.get(i.domain) ?? [];
      arr.push(i);
      m.set(i.domain, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  if (visible.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-800">🩺 数据健康中心</h2>
          <Badge tone="emerald">正常</Badge>
        </div>
        <p className="text-sm text-slate-500">未发现数据问题。</p>
      </Card>
    );
  }

  const errorCount = visible.filter((i) => i.severity === 'error').length;
  const fixable = visible.some((i) => i.fixable);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-slate-800">🩺 数据健康中心</h2>
        <Badge tone={errorCount > 0 ? 'red' : 'amber'}>{visible.length} 个问题{errorCount > 0 ? `（${errorCount} 错误）` : ''}</Badge>
      </div>

      <div className="space-y-3">
        {grouped.map(([domain, list]) => (
          <div key={domain} className="border border-slate-100 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 text-sm font-medium text-slate-700 flex items-center gap-2">
              <span aria-hidden>{DOMAIN_ICONS[domain]}</span> {domainLabel(domain)}
              <span className="text-xs text-slate-400">{list.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {list.map((i) => (
                <div key={i.id} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <button className="flex-1 text-left min-w-0" onClick={() => setExpanded(expanded === i.id ? null : i.id)} aria-expanded={expanded === i.id}>
                      <div className="flex items-center gap-2">
                        <span className={i.severity === 'error' ? 'text-red-500' : 'text-amber-500'} aria-hidden>{i.severity === 'error' ? '✖' : '⚠'}</span>
                        <span className="text-sm text-slate-700 font-medium">{i.title}</span>
                      </div>
                    </button>
                    {issueNavigateTarget(i) && (
                      <button className="text-xs text-slate-400 hover:text-emerald-600" onClick={() => { const t = issueNavigateTarget(i)!; navigate({ tab: t.tab, ...(t.extra ?? {}) }); }}>定位 ›</button>
                    )}
                    <button className="text-xs text-slate-300 hover:text-slate-500" onClick={() => setIgnored((s) => new Set(s).add(i.id))}>忽略</button>
                  </div>
                  {expanded === i.id && (
                    <div className="mt-1 pl-5 text-xs text-slate-500 space-y-1">
                      <p>{i.description}</p>
                      {i.evidence?.map((e, idx) => <p key={idx} className="text-slate-400">· {e}</p>)}
                      {i.fixStrategies.map((s) => <p key={s.id} className="text-emerald-600">✓ {s.label}：{s.description}</p>)}
                      {i.possiblyDestructive && <p className="text-red-500">此操作可能改变数据，修复前自动备份。</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {fixable && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={onFixAll} disabled={busy}>🔧 安全修复（自动备份）</Button>
          <span className="text-xs text-slate-400">修复会先自动备份，成功后可撤销。</span>
        </div>
      )}
    </Card>
  );
}

function ActivityLogCard() {
  const activityLog = useAppStore((s) => s.activityLog);
  const [open, setOpen] = useState(false);
  if (activityLog.length === 0) return null;
  const shown = open ? activityLog : activityLog.slice(0, 5);
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-slate-800">🕰️ 活动日志</h2>
        <span className="text-xs text-slate-400">{activityLog.length} 条</span>
      </div>
      <div className="space-y-1.5 text-sm">
        {shown.map((e) => (
          <div key={e.id} className="flex gap-2 text-xs text-slate-500">
            <span className="shrink-0 tabular text-slate-400">{new Date(e.timestamp).toLocaleString('zh-CN')}</span>
            <span className="min-w-0 truncate">{e.description}</span>
          </div>
        ))}
      </div>
      {activityLog.length > 5 && (
        <button className="text-xs text-emerald-600 mt-2" onClick={() => setOpen(!open)}>{open ? '收起' : `查看全部 ${activityLog.length} 条`}</button>
      )}
      <p className="text-[11px] text-slate-400 mt-2">活动日志只记录事件类型/时间/实体 ID/描述，不记录完整资产 JSON、密码或 PIN。</p>
    </Card>
  );
}
