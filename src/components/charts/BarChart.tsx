
export interface BarItem {
  id: string;
  label: string;
  value: number;
  color: string;
  /** 显示在右侧的补充信息（如占比），可选。 */
  hint?: string;
  emoji?: string;
}

/**
 * 水平条形图：每条都有直接名称标签（颜色不作为唯一识别通道）。
 * 用于渠道对比 / 资产构成。
 */
export function BarChart({
  items,
  valueFormatter = (v) => `¥${v.toFixed(2)}`,
  ariaLabel = '条形图',
  emptyHint = '暂无数据',
}: {
  items: BarItem[];
  valueFormatter?: (v: number) => string;
  ariaLabel?: string;
  emptyHint?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400 text-center py-8" role="img" aria-label={ariaLabel}>
        {emptyHint}
      </p>
    );
  }

  return (
    <div className="space-y-2.5" role="img" aria-label={ariaLabel}>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3">
          <div className="w-32 sm:w-40 shrink-0 flex items-center gap-1.5 min-w-0">
            {item.emoji && <span className="shrink-0" aria-hidden>{item.emoji}</span>}
            <span className="truncate text-sm text-slate-700" title={item.label}>
              {item.label}
            </span>
          </div>
          <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden">
            <div
              className="h-full rounded-md transition-[width] duration-500"
              style={{ width: `${(item.value / max) * 100}%`, background: item.color }}
            />
          </div>
          <div className="w-32 sm:w-40 shrink-0 text-right text-sm tabular">
            <span className="font-medium text-slate-700">{valueFormatter(item.value)}</span>
            {item.hint && <span className="text-slate-500 ml-1 text-xs">{item.hint}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
