import { useEffect, useState } from 'react';
import { storageService } from '../../services/storage';
import { inspectRecoveryCandidate } from '../../services/storage/recoveryCandidate';
import {
  getDefaultDataDir, inspectStorageConfigRecovery, inspectRecoveryRoot,
  readRecoveryCandidate, repairStorageConfigFromCandidate,
  type ConfigRecoveryStatus, type RecoveryRootInspection,
} from '../../services/storage/fs';
import { useAppStore } from '../../store/appStore';

interface Preview { name: string; raw: string; channels: number; snapshots: number; reports: number }

/** Recovery never uses the partially hydrated Store as a source of financial facts. */
export function RecoveryPanel({ error }: { error: string }) {
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [configStatus, setConfigStatus] = useState<ConfigRecoveryStatus | null>(null);
  const [configCheckError, setConfigCheckError] = useState('');
  const [rootInput, setRootInput] = useState('');
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [rootInspection, setRootInspection] = useState<RecoveryRootInspection | null>(null);
  const [configPreview, setConfigPreview] = useState<Preview | null>(null);
  const manager = storageService.getDesktopManager();

  useEffect(() => {
    let active = true;
    void Promise.allSettled([inspectStorageConfigRecovery(), getDefaultDataDir()]).then(([status, suggestion]) => {
      if (!active) return;
      if (status.status === 'fulfilled') setConfigStatus(status.value);
      else setConfigCheckError(status.reason instanceof Error ? status.reason.message : '无法只读检查存储配置');
      if (suggestion.status === 'fulfilled') setDefaultRoot(suggestion.value);
    });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try { await action(); } catch (cause) {
      storageService.pauseWrites();
      setMessage(cause instanceof Error ? cause.message : '恢复失败，写入保持暂停');
    } finally { setBusy(false); }
  }
  async function reload() {
    await storageService.reload();
    storageService.resumeWrites();
    await useAppStore.getState().hydrate();
  }
  async function inspect(name: string) {
    setPreview(null);
    if (!manager) return;
    const { raw } = await manager.inspectBackup(name);
    setPreview({ name, raw, ...inspectRecoveryCandidate(raw) });
  }
  function updateRoot(value: string) {
    setRootInput(value);
    setRootInspection(null);
    setConfigPreview(null);
  }
  async function inspectConfigCandidate(name: string) {
    setConfigPreview(null);
    if (!rootInspection) return;
    const raw = await readRecoveryCandidate(rootInspection.canonicalRoot, name);
    setConfigPreview({ name, raw, ...inspectRecoveryCandidate(raw) });
  }

  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
    <h1 className="text-xl font-semibold">数据需要恢复</h1>
    <p className="max-w-xl">写入已暂停。可以修复存储配置后重新读取，或预览已有备份再确认恢复。恢复前会保留原文件；恢复失败时保持暂停。</p>
    <p role="alert" className="max-w-xl break-words text-red-600">{error}</p>
    {configCheckError && <p role="alert" className="max-w-xl break-words">{configCheckError}。存储配置和用户文件保持原样。</p>}
    {configStatus?.damaged && <section className="max-w-xl w-full border rounded p-4 space-y-3" aria-label="存储配置恢复">
      <h2 className="font-semibold">存储配置损坏</h2>
      <p className="break-words">{configStatus.detail}</p>
      <p>选择已有数据目录，再检查主文件或备份。确认后会修改存储配置并使用所选根目录；选择备份时也会恢复该目录的主文件。原文件逐字保留，目录由用户自行管理。</p>
      <label className="block" htmlFor="recovery-data-root">已有数据目录的绝对路径</label>
      <input id="recovery-data-root" className="w-full p-3 border rounded" value={rootInput} disabled={busy}
        autoComplete="off" spellCheck={false} onChange={event => updateRoot(event.target.value)} />
      <div className="flex flex-wrap gap-3">
        {defaultRoot && <button className="btn" disabled={busy} onClick={() => updateRoot(defaultRoot)}>填入默认位置</button>}
        <button className="btn" disabled={busy || !rootInput.trim()} onClick={() => void run(async () => {
          setRootInspection(null);
          setConfigPreview(null);
          const result = await inspectRecoveryRoot(rootInput);
          setRootInspection(result);
          if (!result.hasPrimaryState && !result.backups.length) setMessage('该目录没有主数据或可识别备份。不能按新安装创建空账本。');
        })}>只读检查目录</button>
      </div>
      {rootInspection && <>
        <p className="break-all">已检查目录：{rootInspection.canonicalRoot}</p>
        <label className="block" htmlFor="config-recovery-candidate">选择文件以预览</label>
        <select id="config-recovery-candidate" className="w-full p-3 border rounded" disabled={busy}
          value={configPreview?.name ?? ''} onChange={event => {
            const name = event.target.value;
            if (name) void run(() => inspectConfigCandidate(name));
            else setConfigPreview(null);
          }}>
          <option value="">请选择主文件或备份</option>
          {rootInspection.hasPrimaryState && <option value="app-state">现有主文件 · data/app-state.json</option>}
          {rootInspection.backups.map(name => <option key={name} value={name}>备份 · {name}</option>)}
        </select>
      </>}
      {configPreview && rootInspection && <div className="border rounded p-3 space-y-3" aria-label="存储配置恢复预览">
        <p>{configPreview.channels} 个父渠道 · {configPreview.snapshots} 个历史快照 · {configPreview.reports} 份报告</p>
        <p>{configPreview.name === 'app-state' ? '使用已检查的主文件，保留损坏配置后重新指定数据目录。' : '以已检查的备份恢复该目录主文件；原主文件及损坏配置各自保留后重新指定数据目录。'}</p>
        <button className="btn" disabled={busy} onClick={() => void run(async () => {
          storageService.pauseWrites();
          const result = await repairStorageConfigFromCandidate(rootInspection.canonicalRoot, configPreview.name, configPreview.raw);
          await reload();
          useAppStore.getState().pushToast(result.durabilityWarning ?? '存储配置和数据已读回验证，原文件副本已保留', result.durabilityWarning ? 'info' : 'success');
        })}>{configPreview.name === 'app-state' ? '确认保留原配置并使用此主文件' : '确认保留原文件、恢复备份并修复配置'}</button>
      </div>}
    </section>}
    <div className="flex flex-wrap gap-3">
      <button className="btn" disabled={busy} onClick={() => void run(reload)}>重新读取数据</button>
      {manager && <button className="btn" disabled={busy} onClick={() => void run(async () => {
        setPreview(null);
        const names = await manager.listBackups();
        setBackups(names);
        if (!names.length) setMessage('没有找到备份。原数据文件保持保留。');
      })}>查找本地备份</button>}
    </div>
    {backups.length > 0 && <label className="max-w-xl w-full">选择备份以预览
      <select className="w-full mt-2 p-3 border rounded" disabled={busy} value={preview?.name ?? ''} onChange={event => {
        const name = event.target.value;
        if (name) void run(() => inspect(name));
      }}><option value="">请选择备份</option>{backups.map(name => <option key={name} value={name}>{name}</option>)}</select>
    </label>}
    {preview && <section className="max-w-xl w-full border rounded p-4 space-y-3" aria-label="恢复预览">
      <h2 className="font-semibold">备份检查通过</h2>
      <p>{preview.channels} 个父渠道 · {preview.snapshots} 个历史快照 · {preview.reports} 份报告</p>
      <p>确认后以此备份替换当前主文件，并重新校验。原文件将以 .preserved 后缀保留在原数据目录。</p>
      <button className="btn" disabled={busy} onClick={() => void run(async () => {
        if (!manager) return;
        storageService.pauseWrites();
        await manager.restoreBackup(preview.name, preview.raw);
        await reload();
      })}>确认保留原文件并恢复此备份</button>
    </section>}
    <p role="status" aria-live="polite" className="max-w-xl break-words">{busy ? '正在检查，请稍候…' : message}</p>
  </main>;
}
