"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/controls";
import {
  type ForecastData,
  MODEL_KEYS,
  MODEL_LABELS,
  type ModelKey,
  type TargetData,
  type TargetKey,
} from "@/lib/time-series/types";

type View = "forecast" | "backtest";
type Plotly = typeof import("plotly.js-basic-dist-min").default;

const DATA_URL = "/data/electricity.json";
const INK = "#17203a";
const MUTED = "#56607a";
const GRID = "rgba(23, 32, 58, 0.08)";
const COLORS: Record<ModelKey | "reference", string> = {
  gbm: "#0072B2",
  mlp: "#009E73",
  naive: "#E69F00",
  reference: "#CC79A7",
};

function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function formatValue(v: number, unit: string) {
  return unit === "MW" ? `${Math.round(v).toLocaleString("en-GB")} MW` : `${v.toFixed(2)} ${unit}`;
}

function formatLocal(iso: string, withYear = false) {
  // Local wall-clock strings from the pipeline ("2026-09-10T07:00"); format without timezone shifts.
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${d} ${month}${withYear ? ` ${y}` : ""}, ${time}`;
}

function bestModel(target: TargetData): ModelKey {
  return MODEL_KEYS.reduce((best, m) =>
    target.backtest.metrics[m].mae < target.backtest.metrics[best].mae ? m : best,
  );
}

function buildTraces(target: TargetData, view: View, visible: Set<string>, band: ModelKey | "none") {
  const traces: object[] = [];
  const hover = target.unit === "MW" ? "%{y:,.0f} MW" : `%{y:.2f} ${target.unit}`;

  if (view === "forecast") {
    const lastTime = target.history.time[target.history.time.length - 1];
    const lastValue = target.history.values[target.history.values.length - 1];
    // Prefix every forecast with the last observation so the lines connect to the history.
    const fx = [lastTime, ...target.forecast.time];

    if (band !== "none") {
      const m = target.forecast.models[band];
      traces.push(
        { x: fx, y: [lastValue, ...m.upper], mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false },
        {
          x: fx,
          y: [lastValue, ...m.lower],
          mode: "lines",
          line: { width: 0 },
          fill: "tonexty",
          fillcolor: withAlpha(COLORS[band], 0.16),
          name: `80% interval (${MODEL_LABELS[band].toLowerCase()})`,
          hoverinfo: "skip",
        },
      );
    }
    traces.push({
      x: target.history.time,
      y: target.history.values,
      mode: "lines",
      name: "Observed",
      line: { color: INK, width: 1.75 },
      hovertemplate: hover,
    });
    for (const m of MODEL_KEYS) {
      if (!visible.has(m)) continue;
      traces.push({
        x: fx,
        y: [lastValue, ...target.forecast.models[m].values],
        mode: "lines",
        name: MODEL_LABELS[m],
        line: { color: COLORS[m], width: m === band ? 2.25 : 1.5 },
        hovertemplate: hover,
      });
    }
    if (target.reference && visible.has("reference") && target.reference.values.some((v) => v !== null)) {
      traces.push({
        x: target.reference.time,
        y: target.reference.values,
        mode: "lines",
        name: target.reference.label,
        line: { color: COLORS.reference, width: 1.5, dash: "dot" },
        hovertemplate: hover,
      });
    }
  } else {
    const s = target.backtest.sample;
    traces.push({
      x: s.time,
      y: s.actual,
      mode: "lines",
      name: "Observed",
      line: { color: INK, width: 1.75 },
      hovertemplate: hover,
    });
    for (const m of MODEL_KEYS) {
      if (!visible.has(m)) continue;
      traces.push({
        x: s.time,
        y: s.models[m],
        mode: "lines",
        name: MODEL_LABELS[m],
        line: { color: COLORS[m], width: 1.5 },
        hovertemplate: hover,
      });
    }
    if (target.reference && visible.has("reference")) {
      traces.push({
        x: s.time,
        y: target.reference.backtest,
        mode: "lines",
        name: target.reference.label,
        line: { color: COLORS.reference, width: 1.5, dash: "dot" },
        hovertemplate: hover,
      });
    }
  }
  return traces;
}

function shiftLocal(iso: string, hours: number) {
  // Wall-clock arithmetic on "YYYY-MM-DDTHH:mm" strings, done in UTC to avoid browser timezone shifts.
  const d = new Date(`${iso}:00Z`);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().slice(0, 16);
}

function buildLayout(target: TargetData, view: View, revision: string) {
  const shapes =
    view === "forecast"
      ? [
          {
            type: "line",
            xref: "x",
            yref: "paper",
            x0: target.origin,
            x1: target.origin,
            y0: 0,
            y1: 1,
            line: { color: MUTED, width: 1, dash: "dash" },
          },
        ]
      : [];
  return {
    height: 420,
    margin: { l: 64, r: 12, t: 12, b: 36 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: '"Instrument Sans Variable", system-ui, sans-serif', size: 13, color: MUTED },
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#fbfcfd", bordercolor: "#cfd5de", font: { color: INK } },
    // The model checkboxes next to the chart double as its legend.
    showlegend: false,
    // Keeps the user's zoom when toggling models; a new series or view starts fresh.
    uirevision: revision,
    xaxis: {
      type: "date",
      // Open on the last four days plus the forecast; double-click shows the full history.
      ...(view === "forecast"
        ? { range: [shiftLocal(target.origin, -96), target.forecast.time[target.forecast.time.length - 1]] }
        : {}),
      gridcolor: GRID,
      linecolor: "#cfd5de",
      tickformat: "%a %d %b",
      hoverformat: "%a %d %b, %H:%M",
      fixedrange: false,
    },
    yaxis: {
      gridcolor: GRID,
      zeroline: view === "forecast" && target.unit !== "MW",
      zerolinecolor: "#cfd5de",
      title: { text: target.unit, font: { size: 13 } },
      tickformat: target.unit === "MW" ? ",.0f" : ".0f",
      fixedrange: false,
    },
    shapes,
    annotations:
      view === "forecast"
        ? [
            {
              x: target.origin,
              xref: "x",
              y: 1,
              yref: "paper",
              text: "Last observation",
              showarrow: false,
              xanchor: "right",
              xshift: -6,
              yanchor: "top",
              font: { size: 12, color: MUTED },
            },
          ]
        : [],
  };
}

export default function ElectricityForecast() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [targetKey, setTargetKey] = useState<TargetKey>("demand");
  const [view, setView] = useState<View>("forecast");
  const [visible, setVisible] = useState<Set<string>>(new Set(["gbm", "mlp", "naive", "reference"]));
  const [bandChoice, setBandChoice] = useState<ModelKey | "none" | "best">("best");
  const chartRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<Plotly | null>(null);
  const [plotlyReady, setPlotlyReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: ForecastData) => !cancelled && setData(json))
      .catch(() => !cancelled && setLoadError(true));
    import("plotly.js-basic-dist-min").then((mod) => {
      if (cancelled) return;
      plotlyRef.current = mod.default;
      setPlotlyReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const target = data?.targets[targetKey];
  const band: ModelKey | "none" = target ? (bandChoice === "best" ? bestModel(target) : bandChoice) : "none";

  useEffect(() => {
    const el = chartRef.current;
    const Plotly = plotlyRef.current;
    if (!el || !Plotly || !target) return;
    Plotly.react(el, buildTraces(target, view, visible, band), buildLayout(target, view, `${targetKey}-${view}`), {
      responsive: true,
      displayModeBar: false,
      scrollZoom: false,
    });
  }, [plotlyReady, target, targetKey, view, visible, band]);

  useEffect(() => {
    const el = chartRef.current;
    return () => {
      if (el && plotlyRef.current) plotlyRef.current.purge(el);
    };
  }, []);

  const rows = useMemo(() => {
    if (!target) return [];
    const r = MODEL_KEYS.map((m) => ({ key: m as string, label: MODEL_LABELS[m], metrics: target.backtest.metrics[m] }));
    if (target.reference?.metrics) r.push({ key: "reference", label: target.reference.label, metrics: target.reference.metrics });
    return r;
  }, [target]);

  if (loadError) {
    return (
      <div className="flex aspect-[16/7] min-h-64 items-center justify-center rounded-[3px] border border-dashed border-rule bg-paper-raised px-6 text-center">
        <p className="max-w-[52ch] font-serif text-[17px] leading-[1.6] text-ink-muted">
          The forecast data has not been generated yet. It is produced by a daily job that downloads the latest data
          from Red Eléctrica.
        </p>
      </div>
    );
  }

  const toggle = (key: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const best = target ? bestModel(target) : null;
  const toggles: { key: string; label: string; color: string }[] = [
    ...MODEL_KEYS.map((m) => ({ key: m as string, label: MODEL_LABELS[m], color: COLORS[m] })),
    ...(target?.reference ? [{ key: "reference", label: target.reference.label, color: COLORS.reference }] : []),
  ];

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-1">
        <div className="relative">
          <div ref={chartRef} className="min-h-[420px] w-full" role="img" aria-label={target ? `${target.label} chart` : "Loading chart"} />
          {(!data || !plotlyReady) && (
            <p className="absolute inset-0 flex items-center justify-center text-[15px] text-ink-muted">Loading chart…</p>
          )}
        </div>
        {target && (
          <p className="mt-2 text-[15px] leading-[1.5] text-ink-muted">
            {view === "forecast"
              ? `Forecast issued from the last observed hour, ${formatLocal(target.origin)} (Madrid time). Shading is an 80% interval built from each model's errors over the last ${target.backtest.days} days.`
              : `Each day, the first 24 hours of that day's forecast, next to what actually happened.`}{" "}
            Drag across the chart to zoom, double-click to reset.
          </p>
        )}
      </div>

      <div className="space-y-8 lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
        <Segmented<TargetKey>
          legend="Series"
          value={targetKey}
          onChange={setTargetKey}
          options={[
            { value: "demand", label: "Demand" },
            { value: "price", label: "Price" },
          ]}
        />
        <Segmented<View>
          legend="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "forecast", label: `Next ${data?.horizonHours ?? 48} hours` },
            { value: "backtest", label: "Last two weeks" },
          ]}
        />

        <fieldset>
          <legend className="mb-2 text-[14px] text-ink-muted">Models</legend>
          <div className="space-y-2">
            {toggles.map((t) => (
              <label key={t.key} className="flex cursor-pointer items-center gap-3 text-[16px] text-ink">
                <input type="checkbox" checked={visible.has(t.key)} onChange={() => toggle(t.key)} className="h-4 w-4 accent-accent" />
                <span aria-hidden className="h-0.5 w-5" style={{ background: t.color }} />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        {view === "forecast" && (
          <div>
            <label htmlFor="band-model" className="mb-2 block text-[14px] text-ink-muted">
              Prediction interval
            </label>
            <select
              id="band-model"
              value={bandChoice}
              onChange={(e) => setBandChoice(e.target.value as ModelKey | "none" | "best")}
              className="w-full rounded-[3px] border border-ink/25 bg-paper px-3 py-2 text-[15px] text-ink"
            >
              <option value="best">Best model{best ? ` (${MODEL_LABELS[best].toLowerCase()})` : ""}</option>
              {MODEL_KEYS.map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABELS[m]}
                </option>
              ))}
              <option value="none">None</option>
            </select>
          </div>
        )}

        {data && (
          <div className="space-y-3 border-t border-rule pt-6 text-[14px] leading-[1.55] text-ink-muted">
            {targetKey === "price" && (
              <p>
                Day-ahead prices for tomorrow are published around midday, so the price forecast starts after the last
                published hour.
              </p>
            )}
            <p>
              Data from {data.source}, peninsular system. Updated daily; last update{" "}
              {new Date(data.generatedAt).toLocaleString("en-GB", {
                timeZone: data.timezone,
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              Madrid time.
            </p>
          </div>
        )}
      </div>
      {/* On small screens the controls sit between the chart and the table; on large screens they span both rows. */}
      <div className="min-w-0 lg:col-span-8 lg:col-start-1">
        {target && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[15px]">
              <caption className="mb-3 text-left font-serif text-[20px] text-ink">
                Accuracy over the last {target.backtest.days} days
              </caption>
              <thead>
                <tr className="border-b border-rule text-[14px] text-ink-muted">
                  <th scope="col" className="py-2 pr-4 font-normal">Model</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">
                    <abbr title="Mean absolute error" className="no-underline">MAE</abbr>
                  </th>
                  {target.unit === "MW" && <th scope="col" className="py-2 pr-4 text-right font-normal">MAPE</th>}
                  <th scope="col" className="py-2 text-right font-normal">vs. naive</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-rule/70">
                    <th scope="row" className="py-2.5 pr-4 font-normal text-ink">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[r.key as ModelKey | "reference"] }} />
                        {r.label}
                        {r.key === best && <span className="text-[13px] text-ink-muted">(best)</span>}
                      </span>
                    </th>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-right text-ink">{formatValue(r.metrics.mae, target.unit)}</td>
                    {target.unit === "MW" && (
                      <td className="whitespace-nowrap py-2.5 pr-4 text-right text-ink">{r.metrics.mape?.toFixed(2)}%</td>
                    )}
                    <td className="whitespace-nowrap py-2.5 text-right text-ink">
                      {r.key === "naive"
                        ? "baseline"
                        : `${(1 - r.metrics.mae / target.backtest.metrics.naive.mae) >= 0 ? "−" : "+"}${Math.abs(
                            (1 - r.metrics.mae / target.backtest.metrics.naive.mae) * 100,
                          ).toFixed(0)}% error`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[14px] leading-[1.55] text-ink-muted">
              One forecast per day, {data?.horizonHours} hours ahead, scored against what was later observed.
              {target.reference?.metrics &&
                " Red Eléctrica's forecast is updated through the day with fresher information, so it is a reference rather than a like-for-like comparison."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
