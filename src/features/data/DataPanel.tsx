import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Card, Button, Badge } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { storageService, getDocumentsDir, openPathInSystem, DATA_FOLDER } from '../../services/storage';
import { parseBackup } from '../../services/export';

export function DataPanel() {
  const { exportData, importData, pushToast, hydrate } = useAppStore();
  const [preview, setPreview] = useState<{ text: string; channels: number; history: number; reports: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const adapterName = storageService.getAdapterName();
  const isDesktop = adapterName === 'desktop';

  const [dataPath, setDataPath] = useState('');
  const [backups, setBackups] = useState<string[]>([]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    void (async () => {
      const dir = await getDocumentsDir();
      if (dir) setDataPath(`${dir}\\${DATA_FOLDER}`);
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
      setPreview({ text, channels: result.data.channels.length, history: result.data.history.length, reports: result.data.reports.length });
    }
    e.target.value = '';
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    const res = await importData(preview.text);
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

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导出数据</h2>
        <p className="text-sm text-slate-500 mb-3">
          将全部资产渠道、历史记录、财务报告与设置导出为 JSON 文件，可用于备份或迁移到其他设备。
        </p>
        <Button onClick={handleExport}>⬇ 导出 JSON 备份</Button>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导入数据</h2>
        <p className="text-sm text-slate-500 mb-3">
          从之前导出的 JSON 文件恢复数据。支持灵光旧版与 Windows 桌面版导出的备份文件。
        </p>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          ⬆ 选择 JSON 文件导入
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFileChosen} className="hidden" aria-label="选择导入文件" />
      </Card>

      {isDesktop && (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-800 mb-2">本地数据与备份</h2>
          <div className="space-y-2 text-sm text-slate-600 mb-3">
            <div>
              数据存储位置：
              <span className="font-mono text-xs text-slate-700 break-all">{dataPath || '加载中…'}</span>
            </div>
            <p className="text-xs text-slate-400">
              复制整个「{DATA_FOLDER}」文件夹即可完成完整人工备份。应用每天首次保存时自动备份一次。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void openPathInSystem(DATA_FOLDER)}>
              📂 打开数据文件夹
            </Button>
            <Button size="sm" variant="outline" onClick={() => void openPathInSystem('backups')}>
              🗄 打开备份文件夹
            </Button>
            <Button size="sm" variant="outline" onClick={() => void doManualBackup()} disabled={busy}>
              💾 立即备份
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void refreshBackups().then(() => setRestoreOpen(true));
              }}
            >
              ♻ 从备份恢复
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">存储与隐私</h2>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <span>存储后端：</span>
            <Badge tone={adapterName === 'desktop' ? 'emerald' : adapterName === 'lingguang' ? 'purple' : 'blue'}>
              {adapterName === 'desktop' ? '桌面文件存储（我的文档）' : adapterName === 'lingguang' ? '灵光运行时' : '浏览器本地存储 (localStorage)'}
            </Badge>
          </div>
          <p>
            你的所有资产数据默认只保存在<strong>你自己的电脑本地</strong>，不会上传到任何服务器。
            「AI 分析」为本地规则算法，不联网、不调用第三方服务。
          </p>
          <p className="text-xs text-slate-400">
            {adapterName === 'browser'
              ? '提示：浏览器清理站点数据会导致本地数据丢失，请定期导出 JSON 备份。'
              : '提示：卸载应用不会删除「我的文档」中的财富数据，请放心。'}
          </p>
        </div>
      </Card>

      {/* 导入预览确认 */}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="确认导入数据"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={importing}>取消</Button>
            <Button variant="danger" onClick={confirmImport} disabled={importing}>
              {importing ? '导入中…' : '覆盖导入'}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">检测到备份包含：</p>
            <ul className="text-sm text-slate-700 space-y-1">
              <li>· {preview.channels} 个渠道</li>
              <li>· {preview.history} 条历史记录</li>
              <li>· {preview.reports} 份财务报告</li>
            </ul>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 space-y-1">
              <p>⚠️ 导入操作将<strong>完全覆盖</strong>当前所有数据，且无法撤销。</p>
              <p>导入前已自动创建当前数据的备份。</p>
            </div>
          </div>
        )}
      </Modal>

      {/* 从备份恢复 */}
      <Modal open={restoreOpen} onClose={() => setRestoreOpen(false)} title="从备份恢复" size="md">
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {backups.length === 0 ? (
            <p className="text-sm text-slate-400">暂无备份文件。</p>
          ) : (
            backups.map((b) => (
              <div key={b} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                <span className="flex-1 text-sm text-slate-700 font-mono text-xs break-all">{b}</span>
                <Button size="sm" variant="outline" onClick={() => setConfirmRestore(b)}>
                  恢复
                </Button>
              </div>
            ))
          )}
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
