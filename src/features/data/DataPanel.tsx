import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Card, Button, Badge } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { storageService, getDocumentsDir, openPathInSystem } from '../../services/storage';
import { parseBackup } from '../../services/export';
import { downloadCSV } from '../../components/charts/export';
import { buildChannelsCsv, buildHistoryCsv } from '../../utils/dataCsv';
import { checkDataHealth } from '../../utils/dataHealth';
import { previewMerge } from '../../utils/mergeData';
import { platformCapabilities } from '../../utils/platform';

export function DataPanel() {
  const { exportData, importData, applyDataFixes, pushToast, hydrate } = useAppStore();
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const reports = useAppStore((s) => s.reports);

  const [preview, setPreview] = useState<{ text: string; channels: number; history: number; reports: number; merge: ReturnType<typeof previewMerge> } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const adapterName = storageService.getAdapterName();
  const isDesktop = adapterName === 'desktop';
  const canOpenFolder = platformCapabilities().canOpenFolder;

  const [dataPath, setDataPath] = useState('');
  const [backups, setBackups] = useState<string[]>([]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const health = useMemo(() => checkDataHealth(channels, history), [channels, history]);
  const subCount = channels.reduce((a, c) => a + (c.children?.length ?? 0), 0);
  const sortedHistory = useMemo(() => [...history].sort((a, b) => (a.date < b.date ? -1 : 1)), [history]);

  useEffect(() => {
    if (!isDesktop) return;
    void (async () => {
      const dir = await getDocumentsDir();
      if (dir) setDataPath(dir);
    })();
  }, [isDesktop]);

  async function refreshBackups() {
    const mgr = storageService.getDesktopManager();
    if (mgr) setBackups(await mgr.listBackups());
  }

  async function handleExport() {
    await exportData();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    e.target.value = '';
  }

  async function doImport(mode: 'replace' | 'merge') {
    if (!preview) return;
    setImporting(true);
    const res = await importData(preview.text, mode);
    setImporting(false);
    setPreview(null);
    pushToast(res.message, res.ok ? 'success' : 'error');
  }

  async function doManualBackup() {
    const mgr = storageService.getDesktopManager();
    if (!mgr) return;
    setBusy(true);
    const name = await mgr.backupNow(true);
    setBusy(false);
    pushToast(name ? `已创建手动备份 ${name}` : '备份失败（尚无数据）', name ? 'success' : 'error');
    await refreshBackups();
  }

  async function doRestore() {
    if (!confirmRestore) return;
    const mgr = storageService.getDesktopManager();
    if (!mgr) return;
    setBusy(true);
    try {
      await mgr.restoreBackup(confirmRestore);
      await storageService.reload();
      await hydrate();
      pushToast('已从备份恢复，数据已刷新', 'success');
    } catch (err) {
      console.error('[data] 恢复失败:', err);
      pushToast('恢复失败', 'error');
    } finally {
      setBusy(false);
      setConfirmRestore(null);
      setRestoreOpen(false);
    }
  }

  async function doFix() {
    const res = await applyDataFixes();
    pushToast(res.fixed > 0 ? `已安全修复 ${res.fixed} 类问题（修复前已自动备份）` : '无需修复', 'success');
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

  return (
    <div className="space-y-4">
      {/* 数据概览 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">数据概览</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <Stat label="父渠道" value={String(channels.length)} />
          <Stat label="子渠道" value={String(subCount)} />
          <Stat label="历史记录" value={String(history.length)} />
          <Stat label="财务报告" value={String(reports.length)} />
          <Stat label="备份数" value={backups.length ? String(backups.length) : '—'} />
          <Stat label="最早历史" value={sortedHistory[0]?.date ?? '—'} />
          <Stat label="最新历史" value={sortedHistory[sortedHistory.length - 1]?.date ?? '—'} />
          <Stat label="存储后端" value={adapterName === 'desktop' ? '文件' : adapterName === 'lingguang' ? '灵光' : '浏览器'} />
        </div>
        {isDesktop && dataPath && <p className="mt-3 text-xs text-slate-500 font-mono break-all">数据目录：{dataPath}</p>}
      </Card>

      {/* 数据健康检查 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-800">数据健康检查</h2>
          <Badge tone={health.ok ? 'emerald' : health.issues.some((i) => i.severity === 'error') ? 'red' : 'amber'}>
            {health.ok ? '正常' : `${health.issues.length} 个问题`}
          </Badge>
        </div>
        {health.ok ? (
          <p className="text-sm text-slate-500">未发现数据问题。</p>
        ) : (
          <>
            <ul className="space-y-1 text-sm text-slate-600 mb-3">
              {health.issues.map((i, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className={i.severity === 'error' ? 'text-red-500' : 'text-amber-500'} aria-hidden>{i.severity === 'error' ? '✖' : '⚠'}</span>
                  <span>{i.message}{i.fixable ? '（可安全修复）' : ''}</span>
                </li>
              ))}
            </ul>
            {health.issues.some((i) => i.fixable) && (
              <Button size="sm" onClick={doFix} disabled={busy}>🔧 安全修复（自动备份）</Button>
            )}
          </>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导出数据</h2>
        <p className="text-sm text-slate-500 mb-3">导出 JSON 全量备份，或导出 CSV 用于 Excel / OriginPro / Python 分析。</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport}>⬇ 导出 JSON 备份</Button>
          <Button variant="outline" onClick={() => exportCsv('channels')}>📊 渠道资产 CSV</Button>
          <Button variant="outline" onClick={() => exportCsv('history')}>📈 历史记录 CSV</Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导入数据</h2>
        <p className="text-sm text-slate-500 mb-3">从 JSON 备份恢复，支持覆盖或合并（ID/日期优先，冲突保留当前）。</p>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>⬆ 选择 JSON 文件导入</Button>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFileChosen} className="hidden" aria-label="选择导入文件" />
      </Card>

      {canOpenFolder && (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-800 mb-2">本地数据与备份</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void openPathInSystem('')}>📂 打开数据文件夹</Button>
            <Button size="sm" variant="outline" onClick={() => void openPathInSystem('backups')}>🗄 打开备份文件夹</Button>
            <Button size="sm" variant="outline" onClick={() => void doManualBackup()} disabled={busy}>💾 立即备份</Button>
            <Button size="sm" variant="outline" onClick={() => { void refreshBackups().then(() => setRestoreOpen(true)); }}>♻ 从备份恢复</Button>
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
              ⚠️ 导入前已自动创建当前数据的备份。
            </div>
          </div>
        )}
      </Modal>

      {/* 从备份恢复 */}
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
        message={`确定用备份「${confirmRestore ?? ''}」覆盖当前数据吗？建议恢复前先手动备份当前数据。`}
        confirmLabel="恢复"
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => void doRestore()}
      />
    </div>
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
