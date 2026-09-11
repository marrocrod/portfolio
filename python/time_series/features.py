"""Calendar features shared by the models. Everything is computed in local time."""

from __future__ import annotations

from functools import lru_cache

import holidays
import numpy as np
import pandas as pd

TZ = "Europe/Madrid"


@lru_cache(maxsize=None)
def _holiday_calendars(years: tuple[int, ...]):
    national = holidays.Spain(years=years)
    regional = [holidays.Spain(subdiv=s, years=years) for s in holidays.Spain.subdivisions]
    return national, regional


def holiday_fraction(dates: pd.DatetimeIndex) -> np.ndarray:
    """Share of Spanish regions observing a public holiday on each date (1.0 = national)."""
    days = pd.DatetimeIndex(dates.normalize().unique())
    years = tuple(sorted({d.year for d in days} | {d.year + 1 for d in days}))
    national, regional = _holiday_calendars(years)
    lookup = {}
    for d in days:
        day = d.date()
        lookup[d] = 1.0 if day in national else sum(day in cal for cal in regional) / len(regional)
    return np.array([lookup[d] for d in dates.normalize()])


def calendar(index_utc: pd.DatetimeIndex) -> pd.DataFrame:
    """Hour, weekday, season and holiday features for UTC timestamps."""
    local = index_utc.tz_convert(TZ)
    naive = local.tz_localize(None)
    doy = naive.dayofyear.to_numpy()
    feats = pd.DataFrame(
        {
            "hour": naive.hour,
            "dow": naive.dayofweek,
            "weekend": (naive.dayofweek >= 5).astype(int),
            "month": naive.month,
            "doy_sin": np.sin(2 * np.pi * doy / 365.25),
            "doy_cos": np.cos(2 * np.pi * doy / 365.25),
            "holiday": holiday_fraction(naive),
            # Bridges: a working day squeezed between a holiday and a weekend behaves like a holiday.
            "holiday_prev": holiday_fraction(naive - pd.Timedelta(days=1)),
            "holiday_next": holiday_fraction(naive + pd.Timedelta(days=1)),
        },
        index=index_utc,
    )
    return feats
