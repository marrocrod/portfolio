"""Forecasting models. Each one maps a history (hourly, UTC index) and an origin t0 to a
forecast for t0+1 ... t0+H. Models only ever see data up to and including t0.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.neural_network import MLPRegressor

from features import calendar

HOUR = pd.Timedelta(hours=1)


def target_index(t0: pd.Timestamp, horizon: int) -> pd.DatetimeIndex:
    return pd.date_range(t0 + HOUR, periods=horizon, freq="1h")


class SeasonalNaive:
    """Same hour one week earlier. The baseline every other model has to beat."""

    name = "Seasonal naive"

    def fit(self, y: pd.Series) -> "SeasonalNaive":
        return self

    def predict(self, y: pd.Series, t0: pd.Timestamp, horizon: int) -> np.ndarray:
        idx = target_index(t0, horizon)
        return y.reindex(idx - pd.Timedelta(days=7)).to_numpy()


class GradientBoosting:
    """Direct multi-horizon gradient boosting.

    One model covers every step ahead: the horizon is a feature, and lags that would fall
    after the origin are set to NaN (HistGradientBoosting handles missing values natively).
    """

    name = "Gradient boosting"

    def __init__(self, horizon: int, origin_step_hours: int = 6, seed: int = 0):
        self.horizon = horizon
        self.origin_step = origin_step_hours
        self.model = HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.06, max_leaf_nodes=63, l2_regularization=1.0, random_state=seed
        )

    def _features(self, y: pd.Series, origins: pd.DatetimeIndex) -> tuple[pd.DataFrame, np.ndarray]:
        h = np.tile(np.arange(1, self.horizon + 1), len(origins))
        # Work on naive UTC datetime64 values; tz-aware arrays become slow object arrays.
        t0 = np.repeat(origins.tz_convert("UTC").tz_localize(None).to_numpy(), self.horizon)
        t = t0 + h.astype("timedelta64[h]")
        t_idx = pd.DatetimeIndex(t).tz_localize("UTC")
        t0_idx = pd.DatetimeIndex(t0).tz_localize("UTC")

        def lag(delta_hours):
            src = t_idx - pd.to_timedelta(delta_hours, unit="h")
            values = y.reindex(src).to_numpy(copy=True)
            values[src > t0_idx] = np.nan  # would leak information from after the origin
            return values

        # Most recent observation at the same hour of day as the target.
        same_hour = y.reindex(t_idx - pd.to_timedelta(24 * np.ceil(h / 24), unit="h")).to_numpy()
        last = y.reindex(t0_idx).to_numpy()
        mean24 = y.rolling(24, min_periods=18).mean().reindex(t0_idx).to_numpy()

        feats = calendar(t_idx).reset_index(drop=True)
        feats["h"] = h
        feats["lag24"] = lag(24)
        feats["lag48"] = lag(48)
        feats["lag168"] = lag(168)
        feats["lag336"] = lag(336)
        feats["same_hour_recent"] = same_hour
        feats["last"] = last
        feats["mean24_at_origin"] = mean24
        return feats, y.reindex(t_idx).to_numpy()

    def fit(self, y: pd.Series) -> "GradientBoosting":
        start = y.index[0] + pd.Timedelta(days=15)
        end = y.index[-1] - self.horizon * HOUR
        origins = pd.date_range(start, end, freq=f"{self.origin_step}h")
        X, target = self._features(y, origins)
        ok = ~np.isnan(target)
        self.model.fit(X[ok], target[ok])
        return self

    def predict(self, y: pd.Series, t0: pd.Timestamp, horizon: int) -> np.ndarray:
        X, _ = self._features(y, pd.DatetimeIndex([t0]))
        return self.model.predict(X)[:horizon]


class NeuralNetwork:
    """Multi-output MLP: the last week of history in, the whole horizon out.

    Each input window is standardized by its own mean and spread, so the network learns
    the shape of the curve rather than its level; outputs are mapped back the same way.
    """

    name = "Neural network"

    def __init__(self, horizon: int, window: int = 168, origin_step_hours: int = 3, seed: int = 0):
        self.horizon = horizon
        self.window = window
        self.origin_step = origin_step_hours
        self.model = MLPRegressor(
            hidden_layer_sizes=(256, 128),
            alpha=1e-3,
            learning_rate_init=1e-3,
            batch_size=128,
            max_iter=300,
            early_stopping=True,
            validation_fraction=0.15,
            n_iter_no_change=15,
            random_state=seed,
        )

    def _sample(self, y: pd.Series, t0: pd.Timestamp):
        hist = y.reindex(pd.date_range(t0 - (self.window - 1) * HOUR, t0, freq="1h")).to_numpy()
        if np.isnan(hist).mean() > 0.05:
            return None
        hist = pd.Series(hist).interpolate(limit_direction="both").to_numpy()
        mu = hist.mean()
        sd = max(hist.std(), 1e-3 * max(abs(mu), 1.0), 1e-6)
        cal = calendar(target_index(t0, self.horizon))
        # Calendar of the first and second target day, plus the local hour of the origin.
        days = cal.iloc[[0, min(24, self.horizon - 1)]]
        extra = np.concatenate(
            [
                np.eye(7)[days["dow"].to_numpy()].ravel(),
                days[["holiday", "holiday_next", "doy_sin", "doy_cos"]].to_numpy().ravel(),
                np.eye(24)[int(cal["hour"].iloc[0])],
            ]
        )
        return np.concatenate([(hist - mu) / sd, extra]), mu, sd

    def fit(self, y: pd.Series) -> "NeuralNetwork":
        start = y.index[0] + self.window * HOUR
        end = y.index[-1] - self.horizon * HOUR
        X, T = [], []
        for t0 in pd.date_range(start, end, freq=f"{self.origin_step}h"):
            sample = self._sample(y, t0)
            target = y.reindex(target_index(t0, self.horizon)).to_numpy()
            if sample is None or np.isnan(target).any():
                continue
            x, mu, sd = sample
            X.append(x)
            T.append((target - mu) / sd)
        self.model.fit(np.array(X), np.array(T))
        return self

    def predict(self, y: pd.Series, t0: pd.Timestamp, horizon: int) -> np.ndarray:
        sample = self._sample(y, t0)
        if sample is None:
            return np.full(horizon, np.nan)
        x, mu, sd = sample
        return (self.model.predict(x[None, :])[0] * sd + mu)[:horizon]
