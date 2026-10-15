import { ZipArchive, ZipError, DEFAULT_ZIP_LIMITS, type ZipLimits } from './zip';

/**
 * OOXML（DOCX）正文解析：
 * - `mc:AlternateContent` 只取一种表示（优先支持能力内的 `mc:Choice`，否则 `mc:Fallback`），避免同一表格被读两遍。
 * - 正文段落、表格与文本框（`w:txbxContent`）分别提取，文本框里的表格带来源标记。
 * - 文本一律按字符串读取，因此基金代码这类前导零不会被数值化。
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
/** 我们能够解析 `mc:Choice` 的命名空间 */
const SUPPORTED_REQUIRES = ['w', 'wps', 'wp', 'a', 'pic', 'mc', 'r', 'm'];

export interface ExtractedCell {
  text: string;
  cellIndex: number;
  gridSpan: number;
  verticalMerge: boolean;
}

export interface ExtractedRow {
  rowIndex: number;
  cells: ExtractedCell[];
  text: string;
  isHeader: boolean;
}

export interface ExtractedTable {
  index: number;
  source: 'body' | 'textbox';
  rows: ExtractedRow[];
  warnings: string[];
}

export interface AlternateDecision {
  index: number;
  chosen: 'choice' | 'fallback';
  requires?: string;
  reason: string;
}

export interface DocxExtraction {
  paragraphs: string[];
  tables: ExtractedTable[];
  alternates: AlternateDecision[];
  warnings: string[];
}

const HEADER_HINT = /^(序号|基金|产品|名称|代码|份额|市值|金额|净值|持仓|收益|盈亏|类型|比例|渠道|账户|备注|计划)/;

function isW(element: Element, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

function isMc(element: Element, localName: string): boolean {
  return element.namespaceURI === MC_NS && element.localName === localName;
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.children);
}

function textOfRuns(element: Element, stopAtTextBox: boolean): string {
  let text = '';
  const walk = (node: Element) => {
    for (const child of elementChildren(node)) {
      if (stopAtTextBox && isW(child, 'txbxContent')) continue;
      if (isW(child, 't')) { text += child.textContent ?? ''; continue; }
      if (isW(child, 'tab')) { text += '\t'; continue; }
      if (isW(child, 'br')) { text += '\n'; continue; }
      if (isW(child, 'tbl') && stopAtTextBox) continue; // 单元格内的嵌套表格单独处理
      walk(child);
    }
  };
  walk(element);
  return text;
}

function requiresList(choice: Element): string[] {
  const value = choice.getAttribute('Requires') ?? choice.getAttributeNS(MC_NS, 'Requires') ?? '';
  return value.split(/\s+/).filter(Boolean);
}

interface WalkState {
  tables: ExtractedTable[];
  paragraphs: string[];
  alternates: AlternateDecision[];
  warnings: string[];
}

/** 把 `mc:AlternateContent` 替换成唯一被选中的分支内容。 */
function resolvedChildren(element: Element, state: WalkState): Element[] {
  const out: Element[] = [];
  for (const child of elementChildren(element)) {
    if (isMc(child, 'AlternateContent')) {
      const choice = elementChildren(child).find((node) => isMc(node, 'Choice'));
      const fallback = elementChildren(child).find((node) => isMc(node, 'Fallback'));
      const required = choice ? requiresList(choice) : [];
      const supported = choice ? required.every((prefix) => SUPPORTED_REQUIRES.includes(prefix)) : false;
      const branch = choice && supported ? choice : fallback ?? choice;
      if (!branch) continue;
      state.alternates.push({
        index: state.alternates.length,
        chosen: branch === choice ? 'choice' : 'fallback',
        ...(required.length ? { requires: required.join(' ') } : {}),
        reason: branch === choice ? '支持 Choice 所需命名空间，读取富文本表示' : 'Choice 不可用，读取 Fallback 表示',
      });
      out.push(...resolvedChildren(branch, state));
      continue;
    }
    out.push(child);
  }
  return out;
}

function extractTable(table: Element, state: WalkState, source: 'body' | 'textbox'): void {
  const warnings: string[] = [];
  const rows: ExtractedRow[] = [];
  const rowElements = elementChildren(table).filter((child) => isW(child, 'tr'));
  let seenHeaderText: string | null = null;
  for (const [rowIndex, rowElement] of rowElements.entries()) {
    const cells: ExtractedCell[] = [];
    const cellElements = elementChildren(rowElement).filter((child) => isW(child, 'tc'));
    for (const [cellIndex, cellElement] of cellElements.entries()) {
      const properties = elementChildren(cellElement).find((child) => isW(child, 'tcPr'));
      const gridSpan = properties ? Number(elementChildren(properties).find((child) => isW(child, 'gridSpan'))?.getAttributeNS(W_NS, 'val') ?? 1) : 1;
      const verticalMerge = Boolean(properties && elementChildren(properties).some((child) => isW(child, 'vMerge')));
      if (gridSpan > 1 || verticalMerge) {
        const message = '存在合并单元格（gridSpan/vMerge），已按原顺序读取，请核对列对齐';
        if (!warnings.includes(message)) warnings.push(message);
      }
      if (elementChildren(cellElement).some((child) => isW(child, 'tbl'))) {
        const message = '单元格内含嵌套表格，已单独递归识别';
        if (!warnings.includes(message)) warnings.push(message);
      }
      cells.push({
        text: textOfRuns(cellElement, true).replace(/\s+/g, ' ').trim(),
        cellIndex,
        gridSpan: Number.isFinite(gridSpan) && gridSpan > 0 ? gridSpan : 1,
        verticalMerge,
      });
    }
    const text = cells.map((cell) => cell.text).join(' | ').trim();
    const nonEmpty = cells.filter((cell) => cell.text.length > 0);
    let isHeader = nonEmpty.length > 0 && nonEmpty.every((cell) => HEADER_HINT.test(cell.text) && !/\d{4,}/.test(cell.text));
    if (isHeader && text === seenHeaderText) {
      isHeader = true;
      const message = '检测到重复表头行，已标记为表头而不是持仓行';
      if (!warnings.includes(message)) warnings.push(message);
    }
    if (isHeader && seenHeaderText === null) seenHeaderText = text;
    rows.push({ rowIndex, cells, text, isHeader });
  }
  state.tables.push({ index: state.tables.length, source, rows, warnings });
}

function walk(element: Element, state: WalkState, insideTextBox: boolean): void {
  for (const child of resolvedChildren(element, state)) {
    if (isW(child, 'txbxContent')) { walk(child, state, true); continue; }
    if (isW(child, 'tbl')) { extractTable(child, state, insideTextBox ? 'textbox' : 'body'); continue; }
    if (isW(child, 'p') && !insideTextBox) {
      const text = textOfRuns(child, true).replace(/\s+/g, ' ').trim();
      if (text) state.paragraphs.push(text);
      walk(child, state, insideTextBox);
      continue;
    }
    walk(child, state, insideTextBox);
  }
}

export function extractDocx(xml: string): DocxExtraction {
  const parser = new DOMParser();
  const document_ = parser.parseFromString(xml, 'application/xml');
  const failure = document_.getElementsByTagName('parsererror');
  if (failure.length) throw new Error('DOCX 正文 XML 解析失败');
  const body = document_.documentElement;
  const state: WalkState = { tables: [], paragraphs: [], alternates: [], warnings: [] };
  walk(body, state, false);
  if (!state.tables.length && !state.paragraphs.length) state.warnings.push('未在正文中找到段落或表格');
  return { paragraphs: state.paragraphs, tables: state.tables, alternates: state.alternates, warnings: state.warnings };
}

/** 从 DOCX 二进制（ZIP 包）读取正文并解析。 */
export async function extractDocxFromPackage(bytes: ArrayBuffer | Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<DocxExtraction> {
  const archive = ZipArchive.open(bytes, limits);
  if (!archive.has('word/document.xml')) throw new ZipError('DOCX 缺少 word/document.xml');
  const xmlBytes = await archive.read('word/document.xml');
  return extractDocx(new TextDecoder('utf-8').decode(xmlBytes));
}
