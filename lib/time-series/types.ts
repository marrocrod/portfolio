// Shape of public/data/electricity.json, written by python/time_series/forecast.py.

export type ModelKey = "naive" | "gbm" | "mlp";
export type TargetKey = "demand" | "price";

type Values = (number | null)[];

export interface Metrics {
  mae: number;
  rmse: number;
  mape?: number;
  skill_vs_naive?: number;
}

export interface TargetData {
  label: string;
  unit: string;
  /** Local time of the last observation the forecast starts from. */
  origin: string;
  history: { time: string[]; values: Values };
  forecast: {
    time: string[];
    models: Record<ModelKey, { values: Values; lower: Values; upper: Values }>;
  };
  backtest: {
    days: number;
    metrics: Record<ModelKey, Metrics>;
    sample: { time: string[]; actual: Values; models: Record<ModelKey, Values> };
  };
  reference?: {
    label: string;
    time: string[];
    values: Values;
    backtest: Values;
    metrics?: Metrics;
  };
}

export interface ForecastData {
  generatedAt: string;
  timezone: string;
  horizonHours: number;
  source: string;
  targets: Record<TargetKey, TargetData>;
}

export const MODEL_LABELS: Record<ModelKey, string> = {
  naive: "Seasonal naive",
  gbm: "Gradient boosting",
  mlp: "Neural network",
};

export const MODEL_KEYS: ModelKey[] = ["naive", "gbm", "mlp"];
