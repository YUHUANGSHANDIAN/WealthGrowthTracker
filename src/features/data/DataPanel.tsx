import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Card, Button, Badge } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { storageService, getDocumentsDir, openPathInSystem } from '../../services/storage';
import { parseBackup } from '../../services/export';
import { downloadCSV } from '../../components/charts/export';
import { buildChannelsCsv, buildHistoryCsv } from '../../utils/dataCsv';
import { checkDataHealth, checkReportHealth, checkGoalHealth, checkAchievementHealth, checkLotteryHealth, domainLabel, type DataIssue, type HealthDomain } from '../../utils/dataHealth';
import { previewMerge } from '../../utils/mergeData';
import { platformCapabilities } from '../../utils/platform';
import { useNavigationStore } from '../../store/navigationStore';

export function DataPanel() {
  const { exportData, importData, applyDataFixes, pushToast, hydrate } = useAppStore();
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

  const adapterName = storageService.getAdapterName();
  const isDesktop = adapterName === 'desktop';
  const canOpenFolder = platformCapabilities().canOpenFolder;

  const [dataPath, setDataPath] = useState('');
  const [backups, setBackups] = useState<string[]>([]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

      {/* 数据健康中心（交互式） */}
      <DataHealthCenter issues={health.issues} onFixAll={doFix} busy={busy} />

      {/* 活动日志 */}
      <ActivityLogCard />


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

function ClickableStat({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-slate-50 hover:bg-emerald-50 rounded-lg py-2 px-1 text-left transition-colors" title={`前往 ${label}`}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-700 tabular break-all">{value} ›</div>
    </button>
  );
}

const DOMAIN_ICONS: Record<HealthDomain, string> = {
  assets: '💰', history: '🕰️', reports: '📑', goals: '🎯', levels: '🏅', lottery: '🎟️', storage: '🗄️', settings: '⚙️',
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
