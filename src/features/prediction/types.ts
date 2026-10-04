import type { PredictionModelType } from '../../types';

/** 统一真实时间轴后的历史数据点（t = 距首个有效日期的 elapsed days）。 */
export interface TimedPoint {
  date: string;
  t: number;
  value: number;
}

/** 数据质量报告。 */
export interface DataQualityReport {
  /** 原始记录数（去重前）。 */
  rawCount: number;
  /** 有效去重后数据点数量。 */
  pointCount: number;
  /** 有效正数点数量（可用于指数模型）。 */
  positiveCount: number;
  /** 首个 / 最后日期。 */
  firstDate: string;
  lastDate: string;
  /** 时间跨度（天）。 */
  spanDays: number;
  /** 平均间隔（天）。 */
  avgIntervalDays: number;
  /** 最大缺口（天）。 */
  maxGapDays: number;
  /** 疑似异常跳变点（相邻日增长率异常高的点，仅供提示、不自动删除）。 */
  anomalies: { date: string; value: number; prevValue: number; jumpRatio: number }[];
  /** 是否存在重复日期被合并。 */
  hadDuplicates: boolean;
}

/** 单个模型的拟合结果与诊断。 */
export interface ModelFit {
  model: PredictionModelType;
  /** 该模型是否适用于当前数据（指数模型可能不适用）。 */
  suitable: boolean;
  notSuitableReason?: string;
  /** 是否触发了安全 fallback（数据不足等）。 */
  fallback: boolean;

  /** 使用的数据点数量。 */
  n: number;
  /** 时间跨度（天）。 */
  spanDays: number;

  // 线性参数（linear / conservative / aggressive 使用）
  slope?: number; // 每日绝对增量（元/天）
  intercept?: number;
  // 指数参数（log-linear，exponential 使用）：ln(y) = expA + expB·t
  expA?: number;
  expB?: number;

  // 诊断指标（对在样本拟合）
  r2?: number;
  mae: number;
  rmse: number;
  smape: number;

  /** 在样本拟合序列（含残差，用于拟合线与残差图）。 */
  fitted: FittedPoint[];

  /** 最近一条真实值（用于预测锚点）。 */
  lastValue: number;
  lastDate: string;
}

/** 在样本拟合点。 */
export interface FittedPoint {
  date: string;
  t: number;
  actual: number;
  fitted: number;
  residual: number;
}

/** 预测点（未来，含预测区间）。 */
export interface ForecastPoint {
  date: string;
  t: number;
  value: number; // 中心预测
  lower95?: number;
  upper95?: number;
  isForecast: true;
}

/** 单模型完整预测结果。 */
export interface Forecast {
  model: PredictionModelType;
  fit: ModelFit;
  horizonDays: number;
  /** 预测区间类型。 */
  intervalType: 'analytic' | 'bootstrap' | 'none';
  intervalNote?: string;
  /** 预测区间置信水平（80/90/95，默认 95）。 */
  intervalLevel?: number;
  points: ForecastPoint[];
}

/** 回测（rolling-origin out-of-sample）指标。 */
export interface BacktestMetrics {
  model: Exclude<PredictionModelType, 'hybrid'>;
  /** 参与回测的窗口数量。 */
  windows: number;
  mae: number;
  rmse: number;
  smape: number;
  /** 是否因为数据不足而无法回测。 */
  insufficient: boolean;
}

/** 混合模型动态权重（四个非 hybrid 模型）。 */
export interface EnsembleWeights {
  linear: number;
  exponential: number;
  conservative: number;
  aggressive: number;
  /** 权重来源：backtest（动态）或 default（数据不足回退）。 */
  source: 'backtest' | 'default';
  /** 是否因数据不足而回退到默认权重。 */
  fallback: boolean;
}

/** 目标金额到达估计。 */
export interface GoalReachEstimate {
  reachable: boolean;
  /** 中心路径预计到达日期（YYYY-MM-DD）。 */
  centralDate?: string;
  /** 保守（较晚）到达日期（若可用）。 */
  conservativeDate?: string;
  /** 积极（较早）到达日期（若可用）。 */
  aggressiveDate?: string;
  /** 无法估计的原因。 */
  reason?: string;
}

/** 智能模型推荐（基于回测，非投资建议）。 */
export interface ModelRecommendation {
  model: PredictionModelType;
  /** 推荐依据。 */
  reasons: string[];
  /** 使用说明（非投资建议）。 */
  notes: string[];
  /** 数据充足性。 */
  sufficient: boolean;
}

/** 预测引擎整体输出（供 UI 消费）。 */
export interface PredictionResult {
  dataQuality: DataQualityReport;
  /** 各模型拟合诊断。 */
  fits: Record<Exclude<PredictionModelType, 'hybrid'>, ModelFit>;
  /** 各模型预测。 */
  forecasts: Record<Exclude<PredictionModelType, 'hybrid'>, Forecast>;
  /** 混合模型预测。 */
  hybrid: Forecast;
  /** 动态权重。 */
  weights: EnsembleWeights;
  /** 回测结果。 */
  backtests: BacktestMetrics[];
  /** 推荐。 */
  recommendation: ModelRecommendation;
}
