export interface ImageChunk {
  index: number;
  box: { x: number; y: number; width: number; height: number };
  /** 与哪些前序分块存在重叠（去重依据） */
  overlaps: number[];
}

/**
 * 长图分块：保留像素坐标与重叠区，重叠内容由调用方按整图哈希+分块哈希去重。
 * 不做整体缩图，避免代码、小数点与负号不可读。
 */
export function planImageChunks(input: { width: number; height: number; chunkHeight?: number; overlap?: number }): ImageChunk[] {
  const { width, height } = input;
  const chunkHeight = input.chunkHeight ?? 2_000;
  const overlap = input.overlap ?? 200;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效');
  if (!Number.isFinite(chunkHeight) || chunkHeight <= 0) throw new Error('分块高度无效');
  if (!Number.isFinite(overlap) || overlap < 0 || overlap * 2 >= chunkHeight) throw new Error('重叠区无效（必须小于分块高度的一半）');
  const chunks: ImageChunk[] = [];
  const step = chunkHeight - overlap;
  let y = 0;
  let index = 0;
  while (y < height) {
    const boxHeight = Math.min(chunkHeight, height - y);
    const overlaps: number[] = [];
    if (index > 0) overlaps.push(index - 1);
    chunks.push({ index, box: { x: 0, y, width, height: boxHeight }, overlaps });
    if (y + boxHeight >= height) break;
    y += step;
    index += 1;
  }
  return chunks;
}

export interface ScopeHints {
  /** 标题声明“全部持有”，包含其它资产类别 */
  allHoldings: boolean;
  /** 明确是“直接基金”清单 */
  directFundList: boolean;
  /** 存在筛选/分页提示 */
  filtered: boolean;
  /** 截图覆盖完整（无“仅显示前 N 条”“展开更多”等提示） */
  complete: boolean;
  notes: string[];
}

const FILTER_HINT = /(筛选|排序|仅显示|展开更多|共\d+条|下一页|第\d+\/\d+页)/;

export function detectScopeHints(text: string): ScopeHints {
  const notes: string[] = [];
  const allHoldings = /全部持有|全部资产|总资产|全部产品/.test(text);
  const directFundList = /直接基金|基金持仓|基金列表/.test(text);
  const filtered = FILTER_HINT.test(text);
  const complete = !filtered && !/展开更多|下一页/.test(text);
  if (allHoldings) notes.push('标题为“全部持有”类声明：包含其它资产类别，不能当作仅直接基金清单');
  if (filtered) notes.push('检测到筛选或分页提示：截图不完整，不能用于集合差集推定');
  return { allHoldings, directFundList, filtered, complete, notes };
}

export interface DirectFundScope {
  directFundList: boolean;
  allHoldings: boolean;
  filtered: boolean;
  complete: boolean;
}

/** D−S 集合差集推定的前置条件：任一不满足即禁止推定，只保留待确认。 */
export function assertDirectFundScope(scope: DirectFundScope): { allowed: boolean; reason?: string } {
  if (scope.allHoldings) return { allowed: false, reason: '来源声明为全部持有，包含非直接基金类别' };
  if (!scope.directFundList) return { allowed: false, reason: '未声明为直接基金清单' };
  if (scope.filtered) return { allowed: false, reason: '存在筛选或分页，集合可能不完整' };
  if (!scope.complete) return { allowed: false, reason: '截图未覆盖完整清单' };
  return { allowed: true };
}
