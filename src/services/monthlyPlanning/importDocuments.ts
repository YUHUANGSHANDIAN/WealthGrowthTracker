import { extractDocxFromPackage } from '../documents/ooxml';
import { extractHoldingRows, type HoldingRowCandidate } from '../documents/holdings';
import { assertIntakeAllowed, intakeDocument, type DocumentKind } from '../documents/intake';
import { detectScopeHints, planImageChunks } from '../documents/image';
import { getAttachment, putAttachment, sha256Hex } from './attachments';
import type { Holding, HoldingObservation, MonthlyReview, SourceDocument } from '../../domain/portfolio/types';
import { classifyFundHolding } from '../../domain/assets/classification';

/**
 * 资料导入的纯逻辑部分（不含保存、不含界面），这样它可以被单测覆盖、
 * 也可以被「从已入库资料生成候选」复用。
 *
 * 两条硬规则：
 * - **绝不静默跳过**：每份文件都返回一条结果（入库 / 内容重复 / 失败），界面必须显示出来。
 * - 没有归属渠道就不造持仓：候选行仍然解析出来并计入结果，但不写进会话，
 *   避免为了「能导入」而把产品明细硬塞进一个随手选的父渠道。
 */
export const EXTRACTED_HOLDING_PREFIX = 'holding:doc:';

export interface DocumentImportOutcome {
  name: string;
  status: 'imported' | 'duplicate' | 'failed';
  documentId?: string;
  /** DOCX 解析出的候选行数 */
  candidates?: number;
  /** 本次是否真的写入了持仓与观察 */
  createdFacts?: boolean;
  note?: string;
  error?: string;
}

export interface DocumentImportResult {
  session: MonthlyReview;
  outcomes: DocumentImportOutcome[];
}

/** 文件的最小接口：输入框的 FileList 会在 `input.value = ''` 时被清空，所以调用方必须先同步快照成数组。 */
export interface FileLike { name: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> }

/** 从文件名里的 YYYYMMDD 解析导出日（20260720 → 2026-07-20）；不可信就返回 undefined。 */
export function declaredDateFromName(name: string): string | undefined {
  const match = /(20\d{2})(\d{2})(\d{2})/.exec(name);
  if (!match) return undefined;
  const value = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

export function extractedHoldingId(documentId: string, tableIndex: number, rowIndex: number): string {
  return `${EXTRACTED_HOLDING_PREFIX}${documentId}:${tableIndex}:${rowIndex}`;
}

export function candidateToHolding(candidate: HoldingRowCandidate, id: string, channelId: string, platform: Holding['platform']): Holding {
  const productType: Holding['productType'] = 'fund';
  const classification = classifyFundHolding({
    name: candidate.name ?? candidate.fundCode ?? '未命名持仓',
    fundCode: candidate.fundCode ?? undefined,
    parentChannelId: channelId,
    exposureTags: [],
    productType,
  });
  return {
    id,
    platform,
    parentChannelId: channelId,
    ...(classification.childChannelId ? { childChannelId: classification.childChannelId } : {}),
    fundCode: candidate.fundCode ?? undefined,
    ...(classification.shareClass ? { shareClass: classification.shareClass } : {}),
    originalName: candidate.name ?? candidate.fundCode ?? '未命名持仓',
    currency: 'CNY',
    productType,
    exposureTags: classification.exposureTags,
  };
}

export function candidateToObservation(
  candidate: HoldingRowCandidate, holdingId: string, sessionKey: string, sourceId: string, channelId: string | null,
): HoldingObservation {
  return {
    id: `obs:${holdingId}`,
    holdingId,
    sessionKey,
    shares: candidate.shares,
    marketValue: candidate.marketValue,
    nav: candidate.nav,
    ...(candidate.navDate ? { navDate: candidate.navDate } : {}),
    evidence: candidate.evidence.map((ref) => ({ ...ref, sourceId })),
    quality: {
      source: 'evidence',
      attribution: channelId ? 'conditional' : 'unassigned',
      valuation: candidate.marketValue === null ? 'missing' : 'observed',
      time: 'observed',
      review: 'pending',
    },
  };
}

interface Facts {
  holdings: Holding[];
  observations: HoldingObservation[];
  created: number;
}

/** 候选行 → 持仓与观察；已存在的持仓 ID 直接跳过，因此重复执行是幂等的。 */
function candidatesToFacts(
  base: Pick<MonthlyReview, 'key'>,
  document: SourceDocument,
  candidates: readonly HoldingRowCandidate[],
  channelId: string,
  existing: { holdings: readonly Holding[]; observations: readonly HoldingObservation[] },
): Facts {
  const holdings = [...existing.holdings];
  const observations = [...existing.observations];
  const known = new Set(holdings.map((holding) => holding.id));
  const knownObs = new Set(observations.map((observation) => observation.holdingId));
  let created = 0;
  for (const candidate of candidates) {
    const id = extractedHoldingId(document.id, candidate.tableIndex, candidate.rowIndex);
    if (!known.has(id)) {
      holdings.push(candidateToHolding(candidate, id, channelId, document.platform));
      known.add(id);
      created += 1;
    }
    if (!knownObs.has(id)) {
      observations.push(candidateToObservation(candidate, id, base.key, document.id, channelId));
      knownObs.add(id);
    }
  }
  return { holdings, observations, created };
}

async function parseDocxCandidates(bytes: Uint8Array, documentId: string): Promise<{ candidates: HoldingRowCandidate[]; warnings: string[] }> {
  const extraction = await extractDocxFromPackage(bytes);
  const { rows, duplicates, tableIssues } = extractHoldingRows(extraction.tables, {
    sourceId: documentId, extractor: 'ooxml', extractorVersion: '1',
  });
  const warnings: string[] = [];
  if (duplicates) warnings.push(`忽略 ${duplicates} 行重复内容（替代表示或重复行）`);
  if (tableIssues.length) warnings.push(tableIssues.join('；'));
  return { candidates: rows, warnings };
}

/**
 * 导入一批文件。返回更新后的会话与**每份文件**的结果，不做保存。
 * 内容重复的文件不会重新入库，但若它此前没有生成候选、而这次选了归属渠道，会补齐候选。
 */
export async function importDocuments(input: {
  session: MonthlyReview;
  files: readonly FileLike[];
  channelId: string | null;
  now: string;
}): Promise<DocumentImportResult> {
  const { session, files, channelId, now } = input;
  let documents: SourceDocument[] = [...session.documents];
  let holdings: Holding[] = [...session.holdings];
  let observations: HoldingObservation[] = [...session.observations];
  const outcomes: DocumentImportOutcome[] = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind: DocumentKind = assertIntakeAllowed(file.name, bytes.byteLength);
      const hash = await sha256Hex(bytes);
      const existingDocument = documents.find((document) => document.sha256 === hash) ?? null;

      if (existingDocument) {
        const notes = ['内容与已入库资料相同，未重复入库'];
        let candidates: number | undefined;
        let createdFacts = false;
        if (kind === 'docx' && channelId) {
          const parsed = await parseDocxCandidates(bytes, existingDocument.id);
          candidates = parsed.candidates.length;
          const facts = candidatesToFacts(session, existingDocument, parsed.candidates, channelId, { holdings, observations });
          holdings = facts.holdings;
          observations = facts.observations;
          createdFacts = facts.created > 0;
          notes.push(createdFacts ? `补齐 ${facts.created} 条候选` : '候选已存在，无需补齐');
        } else if (kind === 'docx') {
          notes.push('未选择归属渠道，未生成候选');
        }
        outcomes.push({ name: file.name, status: 'duplicate', documentId: existingDocument.id, candidates, createdFacts, note: notes.join('；') });
        continue;
      }

      const intake = intakeDocument({
        id: `doc:${hash.slice(0, 12)}`, name: file.name, mime: file.type ?? '', byteLength: bytes.byteLength,
        hash, importedAt: now, ...(declaredDateFromName(file.name) ? { declaredDate: declaredDateFromName(file.name) as string } : {}),
      }, documents);
      const attachment = await putAttachment({ name: file.name, mime: file.type || kind, bytes });
      const document: SourceDocument = { ...intake.document, relativePath: attachment.key, parseState: 'parsed' };
      const notes: string[] = [];
      let candidates: number | undefined;
      let createdFacts = false;

      if (kind === 'docx') {
        const parsed = await parseDocxCandidates(bytes, document.id);
        candidates = parsed.candidates.length;
        notes.push(...parsed.warnings);
        if (!candidates) notes.push('未识别到持仓行，请手工补充');
        if (channelId && candidates) {
          const facts = candidatesToFacts(session, document, parsed.candidates, channelId, { holdings, observations });
          holdings = facts.holdings;
          observations = facts.observations;
          createdFacts = facts.created > 0;
        } else if (candidates) {
          notes.push('未选择归属渠道：只入库资料，未生成候选');
        }
      } else if (kind === 'image') {
        let chunkNote = '';
        try {
          if (typeof createImageBitmap === 'function' && typeof File !== 'undefined' && file instanceof File) {
            const bitmap = await createImageBitmap(file);
            const chunks = planImageChunks({ width: bitmap.width, height: bitmap.height });
            chunkNote = `图片 ${bitmap.width}×${bitmap.height}，分 ${chunks.length} 块（含重叠，识别后去重）`;
            bitmap.close?.();
          }
        } catch { chunkNote = '图片尺寸读取失败，请人工核对范围'; }
        notes.push(`已记录图片与范围声明（${chunkNote || '未分块'}）；需要识别请用「视觉识别」，未配置视觉模型时请手工录入`);
      } else {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        const hints = detectScopeHints(text);
        document.scopeNote = hints.notes.join('；') || undefined;
        notes.push('说明类资料：只作为范围声明与上下文留存，不产生持仓');
      }

      documents = [...documents, document];
      outcomes.push({ name: file.name, status: 'imported', documentId: document.id, candidates, createdFacts, note: notes.join('；') });
    } catch (error) {
      outcomes.push({ name: file.name, status: 'failed', error: error instanceof Error ? error.message : '导入失败' });
    }
  }

  return { session: { ...session, documents, holdings, observations }, outcomes };
}

/**
 * 用已入库的资料重新生成候选（例如导入时没选渠道、或曾经清空过候选）。
 * 只处理还在附件库里的 DOCX，按确定性的持仓 ID 补齐，重复执行幂等。
 */
export async function rebuildCandidatesFromDocuments(input: {
  session: MonthlyReview; channelId: string; now: string;
}): Promise<{ session: MonthlyReview; created: number; scanned: number; skipped: string[] }> {
  const { session, channelId, now } = input;
  let holdings = [...session.holdings];
  let observations = [...session.observations];
  const skipped: string[] = [];
  let created = 0;
  let scanned = 0;
  for (const document of session.documents) {
    if (!/\.docx$/i.test(document.originalName)) continue;
    if (holdings.some((holding) => holding.id.startsWith(`${EXTRACTED_HOLDING_PREFIX}${document.id}:`))) continue;
    scanned += 1;
    try {
      const bytes = await getAttachment({ key: document.relativePath, sha256: document.sha256 });
      const parsed = await parseDocxCandidates(bytes, document.id);
      const facts = candidatesToFacts(session, document, parsed.candidates, channelId, { holdings, observations });
      holdings = facts.holdings;
      observations = facts.observations;
      created += facts.created;
    } catch (error) {
      skipped.push(`${document.originalName}：${error instanceof Error ? error.message : '读取失败'}`);
    }
  }
  return { session: { ...session, holdings, observations, generatedAt: now }, created, scanned, skipped };
}
