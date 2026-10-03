import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { ChartSettings } from '../../types';
import { SelectField } from '../../components/ui/form';

export function ChartControls() {
  const chartSettings = useAppStore((s) => s.chartSettings);
  const setChartSettings = useAppStore((s) => s.setChartSettings);
  const [open, setOpen] = useState(false);

  const set = (patch: Partial<ChartSettings>) => setChartSettings({ ...chartSettings, ...patch });

  const toggle = (key: 'showHistory' | 'showFitted' | 'showForecast' | 'showPredictionBand' | 'showTarget' | 'showDots') => {
    set({ [key]: !(chartSettings[key] ?? true) });
  };

  return (
    <div className="border border-slate-200 rounded-xl bg-white">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-xl" aria-expanded={open}>
        <span>📊 图表设置</span>
        <span className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SelectField label="显示范围" value={chartSettings.timeRange ?? 'all'}
            onChange={(e) => set({ timeRange: e.target.value as ChartSettings['timeRange'] })}
            options={[
              { value: 'all', label: '全部' },
              { value: '30', label: '近30天' },
              { value: '90', label: '近90天' },
              { value: '180', label: '近半年' },
              { value: '365', label: '近1年' },
              { value: 'ytd', label: '今年至今' },
            ]} />
          <SelectField label="时间维度" value={chartSettings.timeDimension ?? 'raw'}
            onChange={(e) => set({ timeDimension: e.target.value as ChartSettings['timeDimension'] })}
            options={[
              { value: 'raw', label: '原始记录' },
              { value: 'daily', label: '日' },
              { value: 'weekly', label: '周' },
              { value: 'monthly', label: '月' },
              { value: 'quarterly', label: '季度' },
              { value: 'yearly', label: '年' },
            ]} />
          <SelectField label="训练窗口" value={chartSettings.trainingWindow ?? 'all'}
            onChange={(e) => set({ trainingWindow: e.target.value as ChartSettings['trainingWindow'] })}
            options={[
              { value: 'all', label: '全部历史' },
              { value: '90', label: '最近90天' },
              { value: '180', label: '最近180天' },
              { value: '365', label: '最近365天' },
            ]} />
          <SelectField label="图表样式" value={chartSettings.chartStyle ?? 'line'}
            onChange={(e) => set({ chartStyle: e.target.value as ChartSettings['chartStyle'] })}
            options={[
              { value: 'line', label: '折线' },
              { value: 'line-dots', label: '折线 + 数据点' },
              { value: 'area', label: '面积' },
              { value: 'scatter', label: '散点 + 拟合线' },
            ]} />
          <div className="sm:col-span-2 flex flex-wrap gap-3 pt-1">
            {([
              ['showHistory', '历史数据'],
              ['showFitted', '拟合线'],
              ['showForecast', '预测线'],
              ['showPredictionBand', '预测区间'],
              ['showTarget', '目标线'],
              ['showDots', '数据点'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={chartSettings[key] ?? true} onChange={() => toggle(key)} className="h-3.5 w-3.5 text-emerald-600 rounded" />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
