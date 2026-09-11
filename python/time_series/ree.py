"""Client for Red Eléctrica's public REData API (https://www.ree.es/es/datos/apidatos).

Only the two widgets used by the forecasting demo are wrapped. Data is fetched month by
month, because long ranges at hourly resolution are rejected or truncated by the API.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta

import pandas as pd
import requests

BASE_URL = "https://apidatos.ree.es/es/datos"
TZ = "Europe/Madrid"

# widget path -> {output column: substring that identifies the indicator title}
WIDGETS = {
    "demanda/demanda-tiempo-real": {"demand": "real", "demand_ree_forecast": "prevista"},
    "mercados/precios-mercados-tiempo-real": {"price": "spot"},
}


def _month_ranges(start: datetime, end: datetime):
    """Yields (first, last) local datetimes covering [start, end] in calendar-month chunks."""
    cursor = start
    while cursor <= end:
        next_month = (cursor.replace(day=1) + timedelta(days=32)).replace(day=1, hour=0, minute=0)
        chunk_end = min(next_month - timedelta(minutes=1), end)
        yield cursor, chunk_end
        cursor = next_month


def _get(url: str, params: dict, retries: int = 4) -> dict:
    for attempt in range(retries):
        try:
            res = requests.get(url, params=params, headers={"Accept": "application/json"}, timeout=60)
            if res.status_code == 200:
                return res.json()
            # 5xx and 429 are worth retrying; anything else is a real error.
            if res.status_code < 500 and res.status_code != 429:
                raise RuntimeError(f"REE API {res.status_code}: {res.text[:300]}")
        except requests.RequestException:
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError(f"REE API kept failing for {url} {params}")


def parse_widget(payload: dict, indicators: dict[str, str]) -> pd.DataFrame:
    """Extracts the requested indicators from a REData response into a UTC-indexed frame."""
    found: dict[str, pd.Series] = {}
    titles = []
    for item in payload.get("included", []):
        attrs = item.get("attributes", {})
        title = str(attrs.get("title", ""))
        titles.append(title)
        for column, needle in indicators.items():
            if needle in title.lower() and column not in found:
                values = attrs.get("values", [])
                index = pd.to_datetime([v["datetime"] for v in values], utc=True)
                found[column] = pd.Series([v["value"] for v in values], index=index, dtype="float64")
    missing = set(indicators) - set(found)
    if missing and titles:
        raise RuntimeError(f"Indicators {missing} not found. Available: {titles}")
    return pd.DataFrame(found)


def fetch(widget: str, start: datetime, end: datetime, pause: float = 0.4) -> pd.DataFrame:
    """Downloads a widget between two local (Europe/Madrid) datetimes."""
    indicators = WIDGETS[widget]
    frames = []
    for first, last in _month_ranges(start, end):
        payload = _get(
            f"{BASE_URL}/{widget}",
            {
                "start_date": first.strftime("%Y-%m-%dT%H:%M"),
                "end_date": last.strftime("%Y-%m-%dT%H:%M"),
                "time_trunc": "hour",
            },
        )
        frame = parse_widget(payload, indicators)
        if not frame.empty:
            frames.append(frame)
        time.sleep(pause)  # be polite to a free public API
    if not frames:
        raise RuntimeError(f"No data returned for {widget}")
    data = pd.concat(frames).sort_index()
    return data[~data.index.duplicated(keep="last")]


def to_hourly(data: pd.DataFrame) -> pd.DataFrame:
    """Averages sub-hourly values (10-minute demand, 15-minute prices) into hourly means.

    For each column, the last observed hour is blanked if it has fewer samples than a
    typical hour, so a partially elapsed hour is never treated as an observation.
    """
    counts = data.resample("1h").count()
    hourly = data.resample("1h").mean()
    for col in hourly:
        c = counts[col]
        observed = c[c > 0]
        if observed.empty:
            continue
        typical = int(observed.mode().iloc[0])
        last = observed.index[-1]
        if observed.iloc[-1] < typical:
            hourly.loc[last, col] = float("nan")
    return hourly
