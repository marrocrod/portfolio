"""Spanish electricity forecasting pipeline.

Fetches peninsular demand and day-ahead prices from Red Eléctrica, backtests three models
on the most recent weeks, refits them on all data and writes the next-48-hour forecasts
to a JSON file that the website reads as a static asset.

Usage (from the repository root):
    pip install -r python/time_series/requirements.txt
    python python/time_series/forecast.py
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

import ree
from models import GradientBoosting, NeuralNetwork, SeasonalNaive, target_index

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "public" / "data" / "electricity.json"
TZ = "Europe/Madrid"
DAY = pd.Timedelta(days=1)

TARGETS = {
    "demand": {"label": "Electricity demand", "unit": "MW", "decimals": 0, "relative_error": True},
    "price": {"label": "Day-ahead price", "unit": "€/MWh", "decimals": 2, "relative_error": False},
}


def local_strings(index: pd.DatetimeIndex) -> list[str]:
    """ISO local times without offset, which is what the chart library expects.

    On the October daylight-saving change the 02:00 hour appears twice; the chart simply
    draws both points at the same wall-clock time.
    """
    return list(index.tz_convert(TZ).strftime("%Y-%m-%dT%H:%M"))


def clean(values, decimals: int) -> list[float | None]:
    out = []
    for v in np.asarray(values, dtype="float64"):
        out.append(None if not np.isfinite(v) else round(float(v), decimals) if decimals else int(round(v)))
    return out


def make_models(horizon: int):
    return {
        "naive": SeasonalNaive(),
        "gbm": GradientBoosting(horizon),
        "mlp": NeuralNetwork(horizon),
    }


def backtest(y: pd.Series, t0: pd.Timestamp, horizon: int, days: int):
    """Trains on data before the test window, then issues one forecast per day."""
    first = t0 - horizon * pd.Timedelta(hours=1) - (days - 1) * DAY
    origins = pd.date_range(first, periods=days, freq="1D")
    train = y[: first]
    actual = np.stack([y.reindex(target_index(o, horizon)).to_numpy() for o in origins])

    preds = {}
    for key, model in make_models(horizon).items():
        started = time.time()
        model.fit(train)
        preds[key] = np.stack([model.predict(y[:o], o, horizon) for o in origins])
        print(f"    backtest {model.name}: {time.time() - started:.1f}s")
    return origins, actual, preds


def metrics(actual: np.ndarray, pred: np.ndarray, relative: bool) -> dict:
    ok = np.isfinite(actual) & np.isfinite(pred)
    err = pred[ok] - actual[ok]
    out = {"mae": float(np.mean(np.abs(err))), "rmse": float(np.sqrt(np.mean(err**2)))}
    if relative:
        out["mape"] = float(np.mean(np.abs(err) / np.abs(actual[ok])) * 100)
    return out


def run_target(key: str, frame: pd.DataFrame, horizon: int, backtest_days: int, history_days: int) -> dict:
    spec = TARGETS[key]
    y = frame[key]
    t0 = y.last_valid_index()
    y = y[:t0]
    print(f"  {key}: {y.notna().sum()} hourly observations, origin {t0.tz_convert(TZ)}")

    origins, actual, preds = backtest(y, t0, horizon, backtest_days)

    # Prediction intervals from backtest residuals, per step ahead (10th-90th percentile).
    residual_q = {
        m: np.nanquantile(actual - p, [0.1, 0.9], axis=0) for m, p in preds.items()
    }

    scores = {m: metrics(actual, p, spec["relative_error"]) for m, p in preds.items()}
    for m in scores:
        scores[m]["skill_vs_naive"] = 1 - scores[m]["mae"] / scores["naive"]["mae"]

    # "Forecast as issued" for the chart: the first 24 hours of each of the last 14 daily forecasts.
    shown = min(14, len(origins))
    sample_idx = pd.DatetimeIndex(
        np.concatenate([target_index(o, 24) for o in origins[-shown:]])
    )
    sample = {
        "time": local_strings(sample_idx),
        "actual": clean(np.concatenate([a[:24] for a in actual[-shown:]]), spec["decimals"]),
        "models": {m: clean(np.concatenate([p[:24] for p in preds[m][-shown:]]), spec["decimals"]) for m in preds},
    }

    # Refit on everything and forecast from the latest observation.
    future = target_index(t0, horizon)
    forecasts = {}
    for m, model in make_models(horizon).items():
        started = time.time()
        model.fit(y)
        point = model.predict(y, t0, horizon)
        lo, hi = residual_q[m]
        forecasts[m] = {
            "values": clean(point, spec["decimals"]),
            "lower": clean(point + lo, spec["decimals"]),
            "upper": clean(point + hi, spec["decimals"]),
        }
        print(f"    final {model.name}: {time.time() - started:.1f}s")

    result = {
        "label": spec["label"],
        "unit": spec["unit"],
        "origin": local_strings(pd.DatetimeIndex([t0]))[0],
        "history": {
            "time": local_strings(y.index[-history_days * 24 :]),
            "values": clean(y.iloc[-history_days * 24 :], spec["decimals"]),
        },
        "forecast": {"time": local_strings(future), "models": forecasts},
        "backtest": {"days": int(backtest_days), "metrics": scores, "sample": sample},
    }

    # Red Eléctrica's own operational forecast, where published, as a reference line.
    ref_col = f"{key}_ree_forecast"
    if ref_col in frame:
        ref = frame[ref_col]
        result["reference"] = {
            "label": "Red Eléctrica forecast",
            "time": local_strings(future),
            "values": clean(ref.reindex(future), spec["decimals"]),
            "backtest": clean(ref.reindex(sample_idx), spec["decimals"]),
        }
        ref_bt = ref.reindex(pd.DatetimeIndex(np.concatenate([target_index(o, horizon) for o in origins])))
        ref_bt = ref_bt.to_numpy().reshape(actual.shape)
        if np.isfinite(ref_bt).mean() > 0.5:
            result["reference"]["metrics"] = metrics(actual, ref_bt, spec["relative_error"])

    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--train-days", type=int, default=730, help="days of history to download")
    parser.add_argument("--horizon", type=int, default=48, help="hours to forecast")
    parser.add_argument("--backtest-days", type=int, default=28)
    parser.add_argument("--history-days", type=int, default=14, help="days of history included in the JSON")
    args = parser.parse_args()

    now = datetime.now(ZoneInfo(TZ)).replace(tzinfo=None)  # naive local time, as the API expects
    start = (now - timedelta(days=args.train_days)).replace(hour=0, minute=0, second=0, microsecond=0)
    # Day-ahead prices are published for tomorrow around midday, so ask for two days ahead.
    end = (now + timedelta(days=2)).replace(hour=23, minute=59, second=0, microsecond=0)

    end_of_today = now.replace(hour=23, minute=59, second=0, microsecond=0)

    print("Downloading demand…")
    # Up to the end of today: real demand stops at "now", Red Eléctrica's forecast continues.
    demand = ree.to_hourly(ree.fetch("demanda/demanda-tiempo-real", start, end_of_today))
    print("Downloading prices…")
    price = ree.to_hourly(ree.fetch("mercados/precios-mercados-tiempo-real", start, end))

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timezone": TZ,
        "horizonHours": args.horizon,
        "source": "Red Eléctrica (REData API)",
        "targets": {},
    }
    for key, frame in (("demand", demand), ("price", price)):
        full = frame.reindex(pd.date_range(frame.index[0], frame.index[-1], freq="1h"))
        output["targets"][key] = run_target(key, full, args.horizon, args.backtest_days, args.history_days)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.out} ({args.out.stat().st_size / 1024:.0f} KB)")
    for key, target in output["targets"].items():
        for model, score in target["backtest"]["metrics"].items():
            extra = f", MAPE {score['mape']:.2f}%" if "mape" in score else ""
            print(f"  {key:6s} {model:6s} MAE {score['mae']:.2f}{extra}, skill {score['skill_vs_naive']:+.1%}")


if __name__ == "__main__":
    main()
