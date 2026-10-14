import { storageService } from '../storage';
import { beginLedgerMaintenance, useAppStore } from '../../store/appStore';
import { assertAIOperationCurrent, validateExplanation, validateExplanationContent, type AuthorizedOperation, type Explanation } from './business';

export interface AIAnnotation {
  id: string;
  reportId: string;
  reportRevision: number;
  profileId: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  explanation: Explanation;
  references: Array<{ factId: string; source: string }>;
}
const key = 'wealth_ai_annotations_v1';
let queue: Promise<unknown> = Promise.resolve();

export async function listAIAnnotations(reportId?: string): Promise<AIAnnotation[]> {
  const stored = await storageService.getJSON<{ schemaVersion: number; annotations: AIAnnotation[] }>(key);
  if (!stored) return [];
  if (stored.schemaVersion !== 1 || !Array.isArray(stored.annotations) || stored.annotations.length > 2_000) throw new Error('AI 附注存储格式无效，已保留原文件');
  const ids = new Set<string>();
  const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  for (const annotation of stored.annotations) {
    if (!annotation || !bounded(annotation.id, 128) || ids.has(annotation.id) || !bounded(annotation.reportId, 256) || !Number.isSafeInteger(annotation.reportRevision) || annotation.reportRevision < 1
      || !bounded(annotation.profileId, 128) || !bounded(annotation.providerId, 32) || !bounded(annotation.modelId, 128)
      || !bounded(annotation.createdAt, 40) || !Number.isFinite(Date.parse(annotation.createdAt)) || !annotation.explanation || !Array.isArray(annotation.references)
      || annotation.references.length > 48 || annotation.references.some(ref => !ref || !bounded(ref.factId, 128) || !bounded(ref.source, 1_000))
      || new Set(annotation.references.map(ref => ref.factId)).size !== annotation.references.length) throw new Error('AI 附注存储损坏，已保留原文件');
    try { validateExplanationContent(JSON.stringify(annotation.explanation), new Set(annotation.references.map(ref => ref.factId))); }
    catch { throw new Error('AI 附注引用或内容损坏，已保留原文件'); }
    ids.add(annotation.id);
  }
  return stored.annotations.filter(a => !reportId || a.reportId === reportId);
}

/** Independently persisted notes cannot overwrite report facts or join ordinary backups. */
export async function saveAIAnnotation(operation: AuthorizedOperation, explanation: Explanation): Promise<AIAnnotation> {
  const action = async () => {
    assertAIOperationCurrent(operation);
    const reportId = operation.pack.manifest.reportId;
    const report = useAppStore.getState().reports.find(r => r.id === reportId);
    if (operation.task !== 'report-interpretation' || !report) throw new Error('仅报告解读可以保存为报告附注');
    const checked = validateExplanation(JSON.stringify(explanation), operation.pack);
    const existing = await listAIAnnotations();
    assertAIOperationCurrent(operation);
    if (existing.length >= 2_000) throw new Error('AI 附注数量已达上限');
    const annotation: AIAnnotation = { id: crypto.randomUUID(), reportId: report.id, reportRevision: report.revision ?? 1,
      profileId: operation.profileId, providerId: operation.providerId, modelId: operation.modelId,
      createdAt: new Date().toISOString(), explanation: checked,
      references: operation.pack.facts.map(f => ({ factId: f.factId, source: f.source })) };
    const release = beginLedgerMaintenance('正在保存独立 AI 附注');
    try {
      assertAIOperationCurrent(operation);
      await storageService.setJSON(key, { schemaVersion: 1, annotations: [...existing, annotation] });
      await storageService.flushAdapter();
    } finally { release(); }
    return annotation;
  };
  const pending = queue.then(action); queue = pending.catch(() => {});
  return pending;
}

export function isAnnotationStale(annotation: AIAnnotation): boolean {
  const report = useAppStore.getState().reports.find(r => r.id === annotation.reportId);
  return !report || (report.revision ?? 1) !== annotation.reportRevision;
}
