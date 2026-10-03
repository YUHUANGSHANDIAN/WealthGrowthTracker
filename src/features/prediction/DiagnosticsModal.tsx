import { useMemo } from 'react';
import type { BacktestMetrics, ModelFit } from './types';
import { PREDICTION_MODELS } from './models';
import { Modal } from '../../components/ui/Modal';
import { formatAmount } from '../../utils/money';

export function DiagnosticsModal({
  fit,
  backtest,
  horizonDays,
  onClose,
}: {
  fit: ModelFit;
  backtest?: BacktestMetrics;
  horizonDays: number;
  onClose: () => void;
}) {
  const meta = PREDICTION_MODELS.find((m) => m.type === fit.model)!;

  return (
    <Modal open onClose={onClose} title={`${meta.name} · 模型诊断`} size="lg">
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium text-slate-700 mb-1">模型定义</div>
          <p className="text-sm text-slate-600">{meta.description}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="数据点" value={String(fit.n)} />
          <Stat label="时间跨度" value={`${fit.spanDays} 天`} />
          <Stat label="预测跨度" value={`${horizonDays} 天`} />
          <Stat label="状态" value={fit.fallback ? '已回退' : fit.suitable ? '适用' : '不适用'} />
        </div>

        {fit.slope !== undefined && (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="斜率（元/天）" value={formatAmount(fit.slope)} />
            <Stat label="截距（元）" value={formatAmount(fit.intercept ?? 0)} />
          </div>
        )}
        {fit.expA !== undefined && (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="ln 截距 a" value={fit.expA.toFixed(4)} />
            <Stat label="ln 斜率 b（/天）" value={fit.expB!.toFixed(4)} />
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {fit.r2 !== undefined && <Stat label="R²" value={fit.r2.toFixed(3)} />}
          <Stat label="MAE" value={formatAmount(fit.mae)} />
          <Stat label="RMSE" value={formatAmount(fit.rmse)} />
          <Stat label="sMAPE" value={`${fit.smape.toFixed(1)}%`} />
        </div>

        {backtest && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="回测窗口" value={backtest.insufficient ? '不足' : String(backtest.windows)} />
            <Stat label="回测 RMSE" value={backtest.insufficient ? '—' : formatAmount(backtest.rmse)} />
            <Stat label="回测 sMAPE" value={backtest.insufficient ? '—' : `${backtest.smape.toFixed(1)}%`} />
          </div>
        )}

        {fit.notSuitableReason && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {fit.notSuitableReason}
          </div>
        )}

        <div>
          <div className="text-sm font-medium text-slate-700 mb-2">残差图（residual vs 时间）</div>
          <ResidualPlot fit={fit} />
          <p className="text-xs text-slate-400 mt-1">残差 = 实际值 − 拟合值。理想情况下残差应围绕 0 随机分布，无明显趋势。</p>
        </div>

        <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
          模型限制：预测仅基于历史总资产轨迹的数学外推，无法区分工资、储蓄、转账与投资收益等来源，不构成投资建议。
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800 tabular break-all">{value}</div>
    </div>
  );
}

const RW = 640;
const RH = 200;
const RM = { top: 16, right: 16, bottom: 32, left: 56 };

function ResidualPlot({ fit }: { fit: ModelFit }) {
  const { points, maxAbs, yLabel } = useMemo(() => {
    const pts = fit.fitted.filter((f) => Number.isFinite(f.residual));
    const maxAbs = Math.max(1, ...pts.map((p) => Math.abs(p.residual)), 1);
    return { points: pts, maxAbs, yLabel: maxAbs.toFixed(0) };
  }, [fit]);

  if (points.length < 2) {
    return <p className="text-sm text-slate-400 py-6 text-center">数据不足，无法绘制残差图</p>;
  }

  const xMax = Math.max(1, points[points.length - 1]!.t);
  const xOf = (t: number) => RM.left + (t / xMax) * (RW - RM.left - RM.right);
  const yOf = (r: number) => RH / 2 - (r / maxAbs) * (RH / 2 - RM.top - RM.bottom);

  return (
    <svg viewBox={`0 0 ${RW} ${RH}`} className="w-full h-auto" role="img" aria-label="残差图">
      {/* 零线 */}
      <line x1={RM.left} x2={RW - RM.right} y1={RH / 2} y2={RH / 2} stroke="#cbd5e1" strokeWidth={1.2} />
      <text x={RM.left - 8} y={yOf(0)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#94a3b8">0</text>
      <text x={RM.left - 8} y={yOf(maxAbs)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#94a3b8">{yLabel}</text>
      <text x={RM.left - 8} y={yOf(-maxAbs)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#94a3b8">-{yLabel}</text>
      {points.map((p, i) => (
        <circle key={i} cx={xOf(p.t)} cy={yOf(p.residual)} r={3} fill={p.residual >= 0 ? '#2a78d6' : '#e34948'} opacity={0.7} />
      ))}
      {/* x 轴时间 */}
      <text x={RM.left} y={RH - 8} fontSize={11} fill="#94a3b8">0 天</text>
      <text x={RW - RM.right} y={RH - 8} textAnchor="end" fontSize={11} fill="#94a3b8">{xMax} 天</text>
    </svg>
  );
}
