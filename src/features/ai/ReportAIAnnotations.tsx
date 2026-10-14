import { useEffect, useState } from 'react';
import { listAIAnnotations, isAnnotationStale, type AIAnnotation } from '../../services/ai/annotations';
import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ExplanationView } from './ExplanationView';
import { AIActionButton } from './AIActionButton';

export function ReportAIAnnotations({ reportId }: { reportId: string }) {
  const hidden = useWorkspaceStore(s => s.amountsHidden);
  const revision = useAppStore(s => s.dataRevision);
  const [annotations, setAnnotations] = useState<AIAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void listAIAnnotations(reportId).then(items => { if (active) { setAnnotations(items); setError(null); } })
      .catch(() => { if (active) setError('附注读取失败，请在数据中心检查存储。原内容已保留。'); });
    return () => { active = false; };
  }, [reportId, revision]);
  return <section className="border-t border-slate-200 pt-4 space-y-3" aria-label="独立 AI 附注">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">独立 AI 附注</h3><AIActionButton task="report-interpretation" reportId={reportId}>解读这份报告</AIActionButton></div>
    {hidden ? <p className="text-sm text-slate-500">金额隐私开启，附注内容已隐藏。</p> : <>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!error && !annotations.length && <p className="text-sm text-slate-500">选择报告事实并授权后生成解读。保存的附注独立于财务报告，普通备份默认不包含。</p>}
      {annotations.map(annotation => <details key={annotation.id} className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm">{new Date(annotation.createdAt).toLocaleString('zh-CN')} · {annotation.modelId}{isAnnotationStale(annotation) ? ' · 来源已变化，请重新解读' : ''}</summary>
        <div className="mt-3"><ExplanationView explanation={annotation.explanation} references={annotation.references} /></div>
      </details>)}
    </>}
  </section>;
}
