#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════╗
║          MIDDLE EAST INSTABILITY MONITOR                                ║
║          Built on WorldMonitor data                                     ║
║          Visualization & analytical layer only                          ║
╚══════════════════════════════════════════════════════════════════════════╝

Architecture:
  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────┐
  │  API Layer  │──▶│  Data Cache  │──▶│  Analytics   │──▶│  Dash UI  │
  │ (fetch/mock)│   │  (in-memory) │   │  (deltas,    │   │ (charts,  │
  │             │   │              │   │   spikes,    │   │  tables,  │
  │             │   │              │   │   summary)   │   │  map)     │
  └─────────────┘   └──────────────┘   └──────────────┘   └───────────┘
"""

# ════════════════════════════════════════════════════════════════════════════
# IMPORTS
# ════════════════════════════════════════════════════════════════════════════

import io
import json
import os
import time
import warnings
from datetime import datetime, timedelta

import dash
import dash_bootstrap_components as dbc
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import requests
from dash import Input, Output, State, dash_table, dcc, html

warnings.filterwarnings("ignore")

# ════════════════════════════════════════════════════════════════════════════
# SECTION: API CONFIGURATION — edit these values to point to your proxy
# ════════════════════════════════════════════════════════════════════════════

PROXY_BASE   = "http://localhost:8001"          # WorldMonitor proxy URL
API_TIMEOUT  = 8                                 # seconds per request
CACHE_TTL    = 10 * 60                           # 10 min — seconds

# ════════════════════════════════════════════════════════════════════════════
# SECTION: DATE RANGE SETTINGS
# ════════════════════════════════════════════════════════════════════════════

HISTORY_DAYS = 180    # how many days of history to display (6 months)
RECENT_DAYS  = 30     # "recent" window for delta calculations

# ════════════════════════════════════════════════════════════════════════════
# SECTION: SPIKE DETECTION THRESHOLDS — tune these
# ════════════════════════════════════════════════════════════════════════════

SPIKE_7D_THRESHOLD    = 5    # +5 pts in 7 days  → spike alert
SPIKE_3D_THRESHOLD    = 4    # +4 pts in 3 days  → sharp spike
VOLATILITY_RATIO      = 1.8  # recent_std / baseline_std > 1.8 → elevated volatility
ACCELERATION_WINDOW   = 14   # days for acceleration check

# ════════════════════════════════════════════════════════════════════════════
# SECTION: COUNTRY LIST — add/remove countries here
# ════════════════════════════════════════════════════════════════════════════
# Geographic metadata only (display coordinates, ISO codes).
# NO scores — all scores are fetched live from WorldMonitor.

ME_COUNTRIES = {
    "IL": {"name": "Israel",       "iso3": "ISR", "lat": 31.5, "lon": 34.8},
    "LB": {"name": "Lebanon",      "iso3": "LBN", "lat": 33.9, "lon": 35.5},
    "SY": {"name": "Syria",        "iso3": "SYR", "lat": 34.8, "lon": 38.9},
    "JO": {"name": "Jordan",       "iso3": "JOR", "lat": 30.6, "lon": 36.2},
    "EG": {"name": "Egypt",        "iso3": "EGY", "lat": 26.0, "lon": 30.0},
    "IR": {"name": "Iran",         "iso3": "IRN", "lat": 32.4, "lon": 53.7},
    "IQ": {"name": "Iraq",         "iso3": "IRQ", "lat": 33.2, "lon": 43.7},
    "SA": {"name": "Saudi Arabia", "iso3": "SAU", "lat": 23.9, "lon": 45.1},
    "TR": {"name": "Turkey",       "iso3": "TUR", "lat": 38.9, "lon": 35.2},
    "QA": {"name": "Qatar",        "iso3": "QAT", "lat": 25.4, "lon": 51.2},
    "AE": {"name": "UAE",          "iso3": "ARE", "lat": 23.4, "lon": 53.8},
    "YE": {"name": "Yemen",        "iso3": "YEM", "lat": 15.6, "lon": 48.5},
}

# ════════════════════════════════════════════════════════════════════════════
# DESIGN TOKENS
# ════════════════════════════════════════════════════════════════════════════

CLR = {
    "bg":       "#08111e",
    "panel":    "#0e1c2f",
    "border":   "#1a2d45",
    "text":     "#d1d9e6",
    "muted":    "#5a7399",
    "accent":   "#3b82f6",
    "critical": "#ef4444",
    "high":     "#f97316",
    "elevated": "#eab308",
    "stable":   "#22c55e",
    "low":      "#06b6d4",
    "grid":     "#0f2035",
}

def score_color(score):
    if score is None or (isinstance(score, float) and pd.isna(score)):
        return CLR["muted"]
    if score >= 75: return CLR["critical"]
    if score >= 60: return CLR["high"]
    if score >= 45: return CLR["elevated"]
    if score >= 30: return CLR["stable"]
    return CLR["low"]

def _is_null(v):
    """True when v is None or a float NaN (pandas serialisation side-effect)."""
    if v is None: return True
    try: return pd.isna(v)
    except: return False

def delta_color(delta):
    if _is_null(delta): return CLR["muted"]
    if delta > 3:  return CLR["critical"]
    if delta > 0:  return CLR["high"]
    if delta < -3: return CLR["stable"]
    if delta < 0:  return "#4ade80"
    return CLR["muted"]

# ════════════════════════════════════════════════════════════════════════════
# API LAYER — WorldMonitor data fetch + mock fallback
# ════════════════════════════════════════════════════════════════════════════

_cache: dict = {}

def _cached(key, ttl, fn):
    """Simple TTL cache."""
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"]) < ttl:
        return entry["data"]
    result = fn()
    _cache[key] = {"data": result, "ts": time.time()}
    return result


def fetch_bootstrap() -> dict:
    """Fetch WorldMonitor /api/bootstrap via proxy. Returns parsed data dict."""
    def _fetch():
        try:
            r = requests.get(
                f"{PROXY_BASE}/api",
                params={"endpoint": "/api/bootstrap"},
                timeout=API_TIMEOUT
            )
            r.raise_for_status()
            j = r.json()
            return j.get("data", j)
        except Exception as e:
            print(f"[API] bootstrap fetch failed: {e}")
            return {}
    return _cached("bootstrap", CACHE_TTL, _fetch)


def fetch_ucdp_events() -> list:
    """
    Fetch UCDP conflict events from WorldMonitor.
    Returns full list; caller filters by country name.
    """
    def _fetch():
        try:
            r = requests.get(
                f"{PROXY_BASE}/api",
                params={"endpoint": "/api/conflict/v1/list-ucdp-events?page_size=2000"},
                timeout=API_TIMEOUT * 2,
            )
            r.raise_for_status()
            j = r.json()
            data = j.get("data", j)
            return data.get("events", data.get("conflicts", []))
        except Exception as e:
            print(f"[API] UCDP fetch failed: {e}")
            return []
    return _cached("ucdp_events", CACHE_TTL, _fetch)


WM_SCRAPE_TTL = 20 * 60   # 20 min cache for scraped data


def fetch_wm_live(iso2: str) -> dict:
    """
    Scrape the WorldMonitor website for live instability data for a country.
    Returns:
        {
          'cii_score': int | None,
          'components': {'Unrest': int, 'Conflict': int, 'Security': int, 'Information': int},
          'brief': str,
          'signals': [str],
          'error': str | None,
        }
    """
    cache_key = f"wm_scrape_{iso2}"
    entry = _cache.get(cache_key)
    if entry and (time.time() - entry["ts"]) < WM_SCRAPE_TTL:
        return entry["data"]

    result = {"cii_score": None, "components": {}, "brief": "", "signals": [], "error": None}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(
                f"https://www.worldmonitor.app/?country={iso2}",
                wait_until="commit",
                timeout=30000,
            )
            # Wait for the CII list to be populated by JS, then extra pause for CDP panel
            page.wait_for_selector(f'.cii-country[data-code="{iso2}"]', timeout=20000)
            time.sleep(3)

            raw = page.evaluate(f'''() => {{
                const el = document.querySelector('.cii-country[data-code="{iso2}"]');
                const briefs = Array.from(document.querySelectorAll('.cdp-assessment-text p'));
                const chips  = Array.from(document.querySelectorAll('.cdp-signal-chip'));
                return {{
                    name:  el ? el.querySelector('.cii-name')?.textContent : null,
                    score: el ? el.querySelector('.cii-score')?.textContent : null,
                    comps: el ? Array.from(el.querySelectorAll('.cii-components span[title]')).map(s => ({{
                        name: s.title, value: s.textContent
                    }})) : [],
                    briefs:  briefs.map(p => p.textContent.trim()).filter(t => t),
                    signals: chips.map(c => c.textContent.trim()).filter(t => t),
                }};
            }}''')
            browser.close()

            if raw and raw.get("score"):
                result["cii_score"] = int(raw["score"])
                for comp in raw.get("comps", []):
                    val_str = comp["value"].split(":")[-1] if ":" in comp["value"] else comp["value"]
                    try:
                        result["components"][comp["name"]] = int(val_str)
                    except ValueError:
                        pass
                result["brief"]   = "\n".join(raw.get("briefs", []))
                result["signals"] = raw.get("signals", [])
    except Exception as e:
        result["error"] = str(e)
        print(f"[WM-scrape] {iso2}: {e}")

    _cache[cache_key] = {"data": result, "ts": time.time()}
    return result


def fetch_global_risk_scores() -> dict:
    """
    Fetch all CII scores from WorldMonitor's global risk-scores endpoint.
    Returns: { iso2: { score, trend, baseline, components, source } }

    Note: /api/intelligence/v1/get-risk-scores returns a fixed global leaderboard
    (the `region` query param is ignored by this endpoint). Countries not in the
    returned list have no WorldMonitor score — we show N/A, not a fallback.
    """
    def _fetch():
        try:
            r = requests.get(
                f"{PROXY_BASE}/api",
                params={"endpoint": "/api/intelligence/v1/get-risk-scores"},
                timeout=API_TIMEOUT,
            )
            if not r.ok:
                return {}
            j    = r.json()
            data = j.get("data", j)
            result = {}
            for entry in data.get("ciiScores", []):
                iso2 = entry.get("region")
                if iso2:
                    result[iso2] = {
                        "score":       entry.get("combinedScore"),
                        "baseline":    entry.get("staticBaseline", 0),
                        "dynamic":     entry.get("dynamicScore", 0),
                        "trend_raw":   entry.get("trend", ""),
                        "components":  entry.get("components", {}),
                        "computed_at": entry.get("computedAt", 0),
                        "source":      "worldmonitor_live",
                    }
            return result
        except Exception as e:
            print(f"[API] global risk scores failed: {e}")
            return {}
    return _cached("global_risk_scores", CACHE_TTL, _fetch)


def parse_live_scores(bootstrap: dict) -> dict:
    """
    Extract current CII scores from WorldMonitor bootstrap payload.
    Returns: { iso2: { score, trend, baseline, components } }
    """
    scores = {}
    cii_list = bootstrap.get("riskScores", {}).get("ciiScores", [])
    for entry in cii_list:
        iso2 = entry.get("region")
        if iso2 and iso2 in ME_COUNTRIES:
            scores[iso2] = {
                "score":      entry.get("combinedScore", 0),
                "baseline":   entry.get("staticBaseline", 0),
                "dynamic":    entry.get("dynamicScore", 0),
                "trend_raw":  entry.get("trend", "TREND_DIRECTION_STABLE"),
                "components": entry.get("components", {}),
                "computed_at": entry.get("computedAt", 0),
                "source":     "worldmonitor_live",
            }
    return scores



# ── Persistent WorldMonitor score log ────────────────────────────────────────
# Each time we fetch live scores from WorldMonitor we append them to a local
# JSON file.  Over time this builds a real historical series with no synthetic
# data.  On first run only today's reading is available.

SCORE_LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "wm_score_log.json")


def _load_score_log() -> list[dict]:
    if not os.path.exists(SCORE_LOG_FILE):
        return []
    try:
        with open(SCORE_LOG_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save_score_log(log: list[dict]) -> None:
    try:
        with open(SCORE_LOG_FILE, "w") as f:
            json.dump(log, f)
    except Exception as e:
        print(f"[log] Could not write score log: {e}")


def append_scores_to_log(scores: dict[str, float]) -> None:
    """
    Persist today's WorldMonitor scores.
    One entry per calendar day — overwrites if already recorded today.
    """
    log = _load_score_log()
    today = datetime.now().date().isoformat()
    # Remove existing entry for today (keep only one per day)
    log = [e for e in log if e.get("date") != today]
    log.append({"date": today, "scores": scores})
    # Retain up to 365 days
    log = log[-365:]
    _save_score_log(log)


def get_country_history(iso2: str, current_score: float) -> pd.DataFrame:
    """
    Return WorldMonitor score history for a country from the persistent local log.
    Only contains real readings fetched from WorldMonitor — no synthetic data.
    If the log has fewer than 2 points, returns just the current reading.
    """
    log = _load_score_log()
    rows = []
    for entry in log:
        score = entry.get("scores", {}).get(iso2)
        if score is not None:
            rows.append({"date": pd.Timestamp(entry["date"]), "score": float(score)})

    # Always include today's current reading (may already be in log)
    today = pd.Timestamp(datetime.now().date())
    if not rows or rows[-1]["date"] < today:
        rows.append({"date": today, "score": float(current_score)})

    df = pd.DataFrame(rows).sort_values("date").drop_duplicates(subset="date")
    cutoff = today - pd.Timedelta(days=HISTORY_DAYS)
    df = df[df["date"] >= cutoff].copy()
    df["is_mock"] = False
    return df


def load_all_data() -> tuple[dict, pd.DataFrame]:
    """
    Load current scores for all ME countries — no hardcoded fallbacks.

    Strategy (in order):
      1. WorldMonitor /api/bootstrap  (batch — fast, covers ~6 ME countries)
      2. WorldMonitor /api/intelligence/v1/get-risk-scores?region={iso2}
         (individual — for countries not in the batch)
      3. If WorldMonitor returns nothing → score is None (shown as N/A)
    """
    bootstrap    = fetch_bootstrap()
    live_scores  = parse_live_scores(bootstrap)          # iso2 → {score, ...}  (from bootstrap)
    global_scores = fetch_global_risk_scores()           # iso2 → {score, ...}  (from leaderboard)

    # Merge: bootstrap takes priority (richer dynamic signals), then global leaderboard
    for iso2, data in global_scores.items():
        if iso2 not in live_scores and iso2 in ME_COUNTRIES:
            live_scores[iso2] = data

    rows = []
    for iso2, meta in ME_COUNTRIES.items():
        live  = live_scores.get(iso2, {})
        score = live.get("score")          # None if WorldMonitor has no data

        # History deltas (only meaningful when score is known)
        d7 = d30 = d180 = None
        if score is not None:
            hist        = get_country_history(iso2, score)
            hist_sorted = hist.sort_values("date")

            def delta_n(n, _s=score, _h=hist_sorted):
                cutoff = pd.Timestamp(datetime.now() - timedelta(days=n))
                past   = _h[_h["date"] <= cutoff]
                if past.empty:
                    return None
                return round(_s - float(past.iloc[-1]["score"]), 1)

            d7   = delta_n(7)
            d30  = delta_n(30)
            d180 = delta_n(180)

        rows.append({
            "iso2":       iso2,
            "iso3":       meta["iso3"],
            "name":       meta["name"],
            "lat":        meta["lat"],
            "lon":        meta["lon"],
            "score":      round(score, 1) if score is not None else None,
            "delta_7d":   d7,
            "delta_30d":  d30,
            "delta_180d": d180,
            "trend_raw":  live.get("trend_raw", ""),
            "has_live":   live.get("source") == "worldmonitor_live",
        })

    df = pd.DataFrame(rows)

    # Rank only countries that have a live score
    scored = df["score"].notna()
    df.loc[scored, "rank"] = (
        df.loc[scored, "score"].rank(ascending=False, method="min").astype(int)
    )
    df["rank"]         = df["rank"].where(scored, other=None)
    df["trend_label"]  = df.apply(_classify_trend, axis=1)
    df["score_band"]   = df["score"].apply(lambda s: _score_band(s) if pd.notna(s) else "N/A")

    # Persist real WorldMonitor scores to the local log
    live_score_map = {
        row["iso2"]: row["score"]
        for _, row in df.iterrows()
        if row.get("has_live") and row["score"] is not None
    }
    if live_score_map:
        append_scores_to_log(live_score_map)

    return live_scores, df


# ════════════════════════════════════════════════════════════════════════════
# ANALYTICS ENGINE
# ════════════════════════════════════════════════════════════════════════════

def _classify_trend(row) -> str:
    d7  = row.get("delta_7d")  or 0
    d30 = row.get("delta_30d") or 0
    if d7 > 3 and d30 > 5:   return "Rising ↑"
    if d7 > 3 or  d30 > 8:   return "Rising ↑"
    if d7 < -3 and d30 < -5: return "Improving ↓"
    if d7 < -3 or  d30 < -8: return "Improving ↓"
    if abs(d7) > 3:           return "Volatile ~"
    return "Stable —"


def _score_band(score) -> str:
    if score >= 75: return "Critical"
    if score >= 60: return "High"
    if score >= 45: return "Elevated"
    if score >= 30: return "Normal"
    return "Low"


def compute_history_analytics(hist_df: pd.DataFrame) -> dict:
    """
    Compute derived analytics from a country's score history.
    All computations are on WorldMonitor score values only.
    """
    df = hist_df.sort_values("date").copy()
    df["ma7"]  = df["score"].rolling(7,  min_periods=1).mean()
    df["ma30"] = df["score"].rolling(30, min_periods=1).mean()

    scores = df["score"].values
    mean_6m = float(np.mean(scores))
    std_6m  = float(np.std(scores)) or 1.0

    # Recent 30-day window
    recent_mask = df["date"] >= (pd.Timestamp.now() - pd.Timedelta(days=30))
    recent      = df[recent_mask]["score"].values
    std_recent  = float(np.std(recent)) if len(recent) > 3 else 0.0

    # Trend slope (linear regression on last 30 days)
    slope_30d = 0.0
    if len(recent) >= 7:
        x = np.arange(len(recent))
        slope_30d = float(np.polyfit(x, recent, 1)[0])

    # Spike detection — windows where score jumps sharply
    spikes = []
    for i in range(7, len(df)):
        jump = df["score"].iloc[i] - df["score"].iloc[i-7]
        if jump >= SPIKE_7D_THRESHOLD:
            spikes.append({
                "date":  df["date"].iloc[i],
                "score": df["score"].iloc[i],
                "jump":  round(jump, 1),
                "type":  "7d_spike",
            })
    for i in range(3, len(df)):
        jump = df["score"].iloc[i] - df["score"].iloc[i-3]
        if jump >= SPIKE_3D_THRESHOLD:
            spikes.append({
                "date":  df["date"].iloc[i],
                "score": df["score"].iloc[i],
                "jump":  round(jump, 1),
                "type":  "3d_sharp",
            })

    # De-duplicate nearby spikes (within 5 days)
    spikes.sort(key=lambda s: s["date"])
    deduped, last_t = [], None
    for s in spikes:
        if last_t is None or (s["date"] - last_t).days > 5:
            deduped.append(s)
            last_t = s["date"]

    return {
        "df":           df,
        "mean_6m":      round(mean_6m, 1),
        "std_6m":       round(std_6m, 1),
        "std_recent":   round(std_recent, 1),
        "slope_30d":    round(slope_30d, 3),
        "spikes":       deduped[-5:],       # last 5 spikes max
        "volatile":     std_recent > VOLATILITY_RATIO * std_6m,
        "above_avg":    float(scores[-1]) > mean_6m if len(scores) else False,
    }


def detect_regional_alerts(summary_df: pd.DataFrame) -> list[dict]:
    """
    Scan all countries for notable score dynamics.
    Returns list of alert dicts sorted by severity.
    """
    alerts = []
    for _, row in summary_df.iterrows():
        d7   = row.get("delta_7d")  or 0
        d30  = row.get("delta_30d") or 0
        name = row["name"]
        iso2 = row["iso2"]
        score= row["score"]

        if d7 >= SPIKE_7D_THRESHOLD:
            alerts.append({
                "country": name, "iso2": iso2, "score": score,
                "severity": "high" if d7 >= 8 else "medium",
                "message": f"+{d7} pts in 7 days — sharp increase detected",
                "icon": "⚠",
            })
        elif d30 >= 10:
            alerts.append({
                "country": name, "iso2": iso2, "score": score,
                "severity": "medium",
                "message": f"+{d30} pts over 30 days — sustained deterioration",
                "icon": "↑",
            })
        elif d7 <= -SPIKE_7D_THRESHOLD:
            alerts.append({
                "country": name, "iso2": iso2, "score": score,
                "severity": "low",
                "message": f"{d7} pts in 7 days — notable improvement",
                "icon": "↓",
            })

    alerts.sort(key=lambda a: {"high": 0, "medium": 1, "low": 2}[a["severity"]])
    return alerts


def generate_narrative(name: str, score: float, row: dict, analytics: dict) -> str:
    """
    Generate a data-driven analytical summary for the selected country.
    All statements are based strictly on observed WorldMonitor score dynamics.
    """
    d7    = row.get("delta_7d")  or 0
    d30   = row.get("delta_30d") or 0
    d180  = row.get("delta_180d") or 0
    mean  = analytics["mean_6m"]
    slope = analytics["slope_30d"]
    vol   = analytics["volatile"]
    band  = row.get("score_band", "")
    trend = row.get("trend_label", "")
    spikes= analytics["spikes"]

    # Opening: current state
    if score >= 75:
        s1 = f"{name} currently registers a {band.lower()} instability score of {score:.0f}, placing it among the most unstable countries in the region."
    elif score >= 55:
        s1 = f"{name} carries an elevated instability score of {score:.0f}, reflecting persistent risk conditions in the WorldMonitor assessment."
    elif score >= 35:
        s1 = f"{name} shows a moderate instability score of {score:.0f}, consistent with an environment of manageable but monitored risk."
    else:
        s1 = f"{name} records a comparatively low instability score of {score:.0f}, suggesting relatively stable conditions in the WorldMonitor reading."

    # Middle: trend over time
    if slope > 0.15:
        s2 = f"The 30-day trend is clearly upward (slope: +{slope:.2f} pts/day), and the current score sits {'+' if score > mean else ''}{score - mean:.1f} pts relative to its 6-month average of {mean:.0f}."
    elif slope < -0.15:
        s2 = f"The 30-day trajectory shows a gradual easing (slope: {slope:.2f} pts/day). The score is {'+' if score > mean else ''}{score - mean:.1f} pts versus the 6-month mean of {mean:.0f}."
    else:
        direction = "above" if score > mean else "below"
        s2 = f"The score is broadly flat over the recent 30-day window, sitting {abs(score - mean):.1f} pts {direction} the 6-month average of {mean:.0f}."

    # Close: volatility or spikes
    if vol:
        s3 = f"Short-term volatility is elevated relative to the 6-month baseline, suggesting recent instability readings have been less predictable than the longer-term pattern."
    elif len(spikes) >= 2:
        last_spike = spikes[-1]
        s3 = f"The 6-month history includes {len(spikes)} notable spike event(s); the most recent on {last_spike['date'].strftime('%d %b')} saw a +{last_spike['jump']} pt jump."
    elif d30 >= 8:
        s3 = f"The 30-day gain of +{d30} pts represents a meaningful deterioration from the position one month ago."
    elif d30 <= -8:
        s3 = f"A 30-day improvement of {d30} pts reflects a meaningful easing in WorldMonitor's assessment over the past month."
    else:
        s3 = f"No significant spike events are recorded in the observed period; week-to-week variation remains within the country's historical range."

    return f"{s1} {s2} {s3}"


# ════════════════════════════════════════════════════════════════════════════
# CHART BUILDERS
# ════════════════════════════════════════════════════════════════════════════

def build_bar_chart(df: pd.DataFrame, selected_iso2: str | None = None, sort_by: str = "score") -> go.Figure:
    df_sorted = df[df["score"].notna()].sort_values(sort_by, ascending=True)

    colors      = []
    line_colors = []
    line_widths = []
    opacities   = []
    for _, row in df_sorted.iterrows():
        is_sel = row["iso2"] == selected_iso2
        colors.append(score_color(row["score"]))
        line_colors.append("white" if is_sel else "rgba(0,0,0,0)")
        line_widths.append(2 if is_sel else 0)
        opacities.append(1.0 if is_sel else (0.55 if selected_iso2 else 1.0))

    fig = go.Figure(go.Bar(
        x=df_sorted["score"],
        y=df_sorted["name"],
        orientation="h",
        marker_color=colors,
        marker_opacity=opacities,
        marker_line_color=line_colors,
        marker_line_width=line_widths,
        text=[f'{s:.0f}' for s in df_sorted["score"]],
        textposition="outside",
        textfont=dict(color=CLR["text"], size=10, family="JetBrains Mono, monospace"),
        hovertemplate="<b>%{y}</b><br>Score: %{x:.1f}<extra></extra>",
    ))
    fig.update_layout(
        paper_bgcolor=CLR["panel"],
        plot_bgcolor=CLR["panel"],
        margin=dict(l=10, r=30, t=10, b=10),
        height=340,
        xaxis=dict(
            range=[0, 100],
            showgrid=True, gridcolor=CLR["grid"], gridwidth=1,
            zeroline=False,
            tickfont=dict(color=CLR["muted"], size=9),
        ),
        yaxis=dict(
            tickfont=dict(color=CLR["text"], size=10, family="Arial"),
            showgrid=False,
        ),
        showlegend=False,
    )
    return fig


def build_history_chart(analytics: dict, country_name: str, score: float) -> go.Figure:
    df = analytics["df"]
    spikes = analytics["spikes"]
    is_mock = df.get("is_mock", pd.Series([False] * len(df))).any() if "is_mock" in df.columns else True

    fig = go.Figure()

    # 30-day shaded band
    cutoff_30 = pd.Timestamp.now() - pd.Timedelta(days=30)
    df_recent = df[df["date"] >= cutoff_30]
    if not df_recent.empty:
        fig.add_vrect(
            x0=df_recent["date"].min(), x1=df_recent["date"].max(),
            fillcolor="rgba(59,130,246,0.05)", line_width=0,
            annotation_text="30d", annotation_position="top left",
            annotation_font=dict(color=CLR["muted"], size=9),
        )

    # Raw score line
    fig.add_trace(go.Scatter(
        x=df["date"], y=df["score"],
        mode="lines",
        name="WM Score",
        line=dict(color=score_color(score), width=1.8),
        hovertemplate="<b>%{x|%d %b %Y}</b><br>Score: %{y:.1f}<extra></extra>",
    ))

    # 7-day MA
    fig.add_trace(go.Scatter(
        x=df["date"], y=df["ma7"],
        mode="lines",
        name="7-day MA",
        line=dict(color="rgba(255,255,255,0.35)", width=1.2, dash="dot"),
        hovertemplate="7d MA: %{y:.1f}<extra></extra>",
    ))

    # 30-day MA
    fig.add_trace(go.Scatter(
        x=df["date"], y=df["ma30"],
        mode="lines",
        name="30-day MA",
        line=dict(color="rgba(255,255,255,0.18)", width=1.2, dash="dash"),
        hovertemplate="30d MA: %{y:.1f}<extra></extra>",
    ))

    # 6-month average line
    fig.add_hline(
        y=analytics["mean_6m"],
        line=dict(color="rgba(255,255,255,0.12)", width=1, dash="longdash"),
        annotation_text=f"6m avg: {analytics['mean_6m']:.0f}",
        annotation_position="bottom right",
        annotation_font=dict(color=CLR["muted"], size=9),
    )

    # Spike markers
    for sp in spikes:
        fig.add_trace(go.Scatter(
            x=[sp["date"]], y=[sp["score"]],
            mode="markers+text",
            marker=dict(color=CLR["critical"], size=9, symbol="triangle-up",
                        line=dict(color="white", width=0.8)),
            text=[f'+{sp["jump"]}'],
            textposition="top center",
            textfont=dict(color=CLR["critical"], size=8),
            showlegend=False,
            hovertemplate=f'<b>Spike detected</b><br>Date: {sp["date"].strftime("%d %b")}<br>+{sp["jump"]} pts<extra></extra>',
        ))

    data_note = f" · {len(df)} readings recorded" if not is_mock else ""

    fig.update_layout(
        paper_bgcolor=CLR["panel"],
        plot_bgcolor=CLR["bg"],
        margin=dict(l=10, r=10, t=36, b=10),
        height=310,
        title=dict(
            text=f"{country_name} — WorldMonitor Score · 6 Months{data_note}",
            font=dict(color=CLR["muted"], size=11),
            x=0.01,
        ),
        legend=dict(
            orientation="h", x=0, y=1.12,
            font=dict(color=CLR["muted"], size=9),
            bgcolor="rgba(0,0,0,0)",
        ),
        hovermode="x unified",
        xaxis=dict(
            showgrid=True, gridcolor=CLR["grid"], gridwidth=1,
            zeroline=False, tickfont=dict(color=CLR["muted"], size=9),
            showspikes=True, spikecolor=CLR["muted"], spikethickness=1,
        ),
        yaxis=dict(
            showgrid=True, gridcolor=CLR["grid"], gridwidth=1,
            range=[0, 100],
            tickfont=dict(color=CLR["muted"], size=9),
            zeroline=False,
        ),
    )
    return fig


def build_map(df: pd.DataFrame, selected_iso2: str | None = None) -> go.Figure:
    fig = go.Figure()

    # Country polygons via choropleth (background tone)
    fig.add_trace(go.Choropleth(
        locations=df[df["score"].notna()]["iso3"],
        z=df[df["score"].notna()]["score"],
        colorscale=[
            [0.0,  "#0d3b1f"],
            [0.3,  "#1a5c1a"],
            [0.5,  "#7d5a00"],
            [0.75, "#8b1a00"],
            [1.0,  "#500000"],
        ],
        zmin=0, zmax=100,
        showscale=False,
        marker_line_color=CLR["border"],
        marker_line_width=1,
        hoverinfo="skip",
    ))

    # Score labels as scatter dots (show all countries; N/A when no live score)
    for _, row in df.iterrows():
        is_sel  = row["iso2"] == selected_iso2
        has_score = row["score"] is not None and not (isinstance(row["score"], float) and pd.isna(row["score"]))
        dot_label = f"{row['score']:.0f}" if has_score else "N/A"
        fig.add_trace(go.Scattergeo(
            lat=[row["lat"]],
            lon=[row["lon"]],
            mode="markers+text",
            marker=dict(
                size=24 if is_sel else 18,
                color=score_color(row["score"]),
                opacity=1.0 if is_sel else 0.85,
                line=dict(color="white" if is_sel else CLR["border"], width=2 if is_sel else 0.5),
                symbol="circle",
            ),
            text=[dot_label],
            textfont=dict(
                color="white",
                size=9 if not is_sel else 11,
                family="JetBrains Mono, monospace",
            ),
            textposition="middle center",
            name=row["name"],
            customdata=[[row["iso2"], row["name"], row["score"] if has_score else None,
                         row.get("delta_30d") or 0, row.get("trend_label", "")]],
            hovertemplate=(
                "<b>%{customdata[1]}</b><br>"
                "Score: <b>%{customdata[2]}</b><br>"
                "30d change: %{customdata[3]:+.1f}<br>"
                "Trend: %{customdata[4]}<extra></extra>"
            ),
            showlegend=False,
        ))

    fig.update_geos(
        scope="world",
        projection_type="natural earth",
        lataxis_range=[10, 45],
        lonaxis_range=[24, 68],
        showland=True,      landcolor="#0d1a2b",
        showocean=True,     oceancolor="#060f1a",
        showlakes=False,
        showrivers=False,
        showcountries=True, countrycolor=CLR["border"],
        showcoastlines=True, coastlinecolor=CLR["border"],
        bgcolor=CLR["bg"],
        resolution=50,
    )
    fig.update_layout(
        paper_bgcolor=CLR["panel"],
        margin=dict(l=0, r=0, t=0, b=0),
        height=370,
        geo_bgcolor=CLR["bg"],
        dragmode=False,
    )
    return fig


# ════════════════════════════════════════════════════════════════════════════
# LAYOUT COMPONENTS
# ════════════════════════════════════════════════════════════════════════════

def kpi_card(label: str, value: str, sub: str = "", color: str = CLR["text"], width: int = 2):
    return dbc.Col(
        dbc.Card([
            dbc.CardBody([
                html.P(label, className="kpi-label"),
                html.H4(value, className="kpi-value", style={"color": color}),
                html.P(sub, className="kpi-sub") if sub else html.Span(),
            ], className="p-3"),
        ], className="kpi-card"),
        width=width,
    )


def metric_tile(label: str, value: str, color: str = CLR["text"]):
    return html.Div([
        html.P(label, style={"color": CLR["muted"], "fontSize": "10px",
                              "textTransform": "uppercase", "letterSpacing": "0.08em",
                              "marginBottom": "2px"}),
        html.P(value, style={"color": color, "fontSize": "20px",
                              "fontWeight": "700", "fontFamily": "JetBrains Mono, monospace",
                              "marginBottom": "0"}),
    ], style={"padding": "10px 14px", "background": CLR["bg"],
              "borderRadius": "6px", "border": f"1px solid {CLR['border']}"})


def section_header(title: str):
    return html.Div(title, style={
        "fontSize": "10px", "fontWeight": "700", "letterSpacing": "0.12em",
        "textTransform": "uppercase", "color": CLR["accent"],
        "borderBottom": f"1px solid {CLR['border']}",
        "paddingBottom": "6px", "marginBottom": "12px",
    })


# ════════════════════════════════════════════════════════════════════════════
# DASH APP INITIALIZATION
# ════════════════════════════════════════════════════════════════════════════

app = dash.Dash(
    __name__,
    external_stylesheets=[
        dbc.themes.SLATE,
        "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600&display=swap",
    ],
    title="ME Instability Monitor",
)

# Pre-load data at startup so charts render immediately on first page visit
print("[startup] Loading initial data…")
try:
    _, _initial_df = load_all_data()
    _initial_json = _initial_df.to_json(date_format="iso", orient="records")
    print(f"[startup] Loaded {len(_initial_df)} countries OK")
except Exception as _e:
    print(f"[startup] Initial load failed: {_e}")
    _initial_json = None

# ── Custom CSS ───────────────────────────────────────────────────────────────
app.index_string = '''
<!DOCTYPE html>
<html>
<head>
{%metas%}
<title>{%title%}</title>
{%favicon%}
{%css%}
<style>
  * { box-sizing: border-box; }
  body { background: #08111e !important; color: #d1d9e6; font-family: "Inter", sans-serif; margin: 0; }
  .kpi-card { background: #0e1c2f !important; border: 1px solid #1a2d45 !important; border-radius: 8px !important; }
  .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #5a7399; margin-bottom: 4px; }
  .kpi-value { font-family: "JetBrains Mono", monospace; font-size: 1.35rem; margin-bottom: 2px; }
  .kpi-sub { font-size: 10px; color: #5a7399; margin-bottom: 0; }
  .panel { background: #0e1c2f; border: 1px solid #1a2d45; border-radius: 8px; padding: 14px; margin-bottom: 12px; }
  .alert-item { padding: 8px 12px; border-radius: 5px; margin-bottom: 6px; font-size: 11px; }
  .alert-high   { background: rgba(239,68,68,0.12);  border-left: 3px solid #ef4444; }
  .alert-medium { background: rgba(249,115,22,0.12); border-left: 3px solid #f97316; }
  .alert-low    { background: rgba(34,197,94,0.12);  border-left: 3px solid #22c55e; }
  .summary-box { font-size: 12px; line-height: 1.7; color: #b0bfcf; background: #08111e;
                 border: 1px solid #1a2d45; border-radius: 6px; padding: 14px 16px; }
  .dash-table-container .dash-spreadsheet-container .dash-spreadsheet-inner th {
    background: #0e1c2f !important; color: #3b82f6 !important; font-size: 10px !important;
    text-transform: uppercase; letter-spacing: 0.08em; border-color: #1a2d45 !important; }
  .dash-table-container .dash-spreadsheet-container .dash-spreadsheet-inner td {
    background: #08111e !important; color: #d1d9e6 !important; font-size: 11px !important;
    border-color: #1a2d45 !important; font-family: "JetBrains Mono", monospace; }
  .dash-table-container .dash-spreadsheet-container .dash-spreadsheet-inner tr:hover td {
    background: #0e1c2f !important; cursor: pointer; }
  .Select-control, .Select-menu-outer { background: #0e1c2f !important; border-color: #1a2d45 !important; }
  .Select-value-label { color: #d1d9e6 !important; }
  .dash-dropdown .Select-control { background: #0e1c2f !important; }
  .dash-dropdown .Select-menu-outer { background: #0e1c2f !important; }
</style>
</head>
<body>
{%app_entry%}
<footer>{%config%}{%scripts%}{%renderer%}</footer>
</body>
</html>
'''

# ── App Layout ───────────────────────────────────────────────────────────────
app.layout = dbc.Container([

    # ── HEADER ──────────────────────────────────────────────────────────────
    dbc.Row([
        dbc.Col([
            html.Div([
                html.Span("MIDDLE EAST INSTABILITY MONITOR", style={
                    "fontSize": "16px", "fontWeight": "700", "letterSpacing": "0.15em",
                    "color": "#d1d9e6", "display": "block",
                }),
                html.Span(
                    "Analytical visualization layer based on WorldMonitor data. "
                    "Does not replace or replicate WorldMonitor methodology.",
                    style={"fontSize": "10px", "color": CLR["muted"], "letterSpacing": "0.04em"},
                ),
            ]),
        ], width=8),
        dbc.Col([
            html.Div([
                html.Span("● LIVE", style={"color": CLR["stable"], "fontSize": "10px",
                                            "fontFamily": "JetBrains Mono, monospace"}),
                html.Span("  WorldMonitor", style={"color": CLR["muted"], "fontSize": "10px",
                                                    "marginLeft": "8px"}),
                html.Span(id="last-updated", style={"color": CLR["muted"], "fontSize": "10px",
                                                      "marginLeft": "8px"}),
            ], style={"textAlign": "right", "paddingTop": "8px"}),
        ], width=4),
    ], style={"background": "#060d17", "borderBottom": f"1px solid {CLR['border']}",
               "padding": "14px 0 10px", "marginBottom": "16px"}),

    # ── KPI CARDS ────────────────────────────────────────────────────────────
    dbc.Row(id="kpi-row", className="g-2 mb-3"),

    # ── MAP + COMPARISON TABLE ───────────────────────────────────────────────
    dbc.Row([
        dbc.Col([
            html.Div([
                section_header("Regional Map — WorldMonitor Score"),
                dcc.Graph(id="region-map", config={"displayModeBar": False}),
            ], className="panel"),
        ], width=7),
        dbc.Col([
            html.Div([
                section_header("Regional Comparison"),
                dcc.Graph(id="bar-chart", config={"displayModeBar": False},
                          style={"height": "340px"}),
            ], className="panel"),
        ], width=5),
    ], className="g-3 mb-3"),

    # ── COUNTRY SELECTOR + DRILL-DOWN ────────────────────────────────────────
    dbc.Row([
        dbc.Col([
            html.Div([
                section_header("Country Drill-Down"),
                dcc.Dropdown(
                    id="country-select",
                    options=[{"label": v["name"], "value": k}
                             for k, v in sorted(ME_COUNTRIES.items(), key=lambda x: x[1]["name"])],
                    value="IR",
                    clearable=False,
                    style={"marginBottom": "12px",
                           "fontFamily": "Inter, sans-serif", "fontSize": "13px"},
                ),
                dcc.Loading(type="circle", color=CLR["accent"],
                            children=html.Div(id="drilldown-metrics")),
            ], className="panel"),
        ], width=3),
        dbc.Col([
            html.Div([
                section_header("Historical Trend — 6 Months"),
                dcc.Loading(type="circle", color=CLR["accent"],
                            children=dcc.Graph(id="history-chart",
                                               config={"displayModeBar": False})),
            ], className="panel"),
        ], width=9),
    ], className="g-3 mb-3"),

    # ── ALERTS + NARRATIVE SUMMARY ────────────────────────────────────────────
    dbc.Row([
        dbc.Col([
            html.Div([
                section_header("Alerts — Selected Country"),
                dcc.Loading(type="dot", color=CLR["accent"],
                            children=html.Div(id="alerts-panel")),
            ], className="panel", style={"minHeight": "180px"}),
        ], width=4),
        dbc.Col([
            html.Div([
                section_header("Analytical Summary"),
                dcc.Loading(type="dot", color=CLR["accent"],
                            children=html.Div(id="narrative-box")),
            ], className="panel"),
        ], width=8),
    ], className="g-3 mb-3"),

    # ── LIVE INTELLIGENCE (WorldMonitor website scrape) ───────────────────────
    dbc.Row([
        dbc.Col([
            html.Div([
                section_header("Live Intelligence — WorldMonitor"),
                dcc.Loading(type="circle", color=CLR["accent"],
                            children=html.Div(id="live-intel-panel")),
            ], className="panel"),
        ], width=12),
    ], className="g-3 mb-3"),

    # ── CONFLICT EVENTS (UCDP) ───────────────────────────────────────────────
    dbc.Row([
        dbc.Col([
            html.Div([
                section_header("Conflict Events — UCDP (WorldMonitor)"),
                dcc.Loading(type="circle", color=CLR["accent"],
                            children=html.Div(id="ucdp-panel")),
            ], className="panel"),
        ], width=12),
    ], className="g-3 mb-3"),

    # ── DATA STORE ────────────────────────────────────────────────────────────
    dcc.Store(id="data-store", data=_initial_json),   # pre-populated at startup
    dcc.Interval(id="refresh-interval", interval=CACHE_TTL * 1000, n_intervals=0),

], fluid=True, style={"background": CLR["bg"], "minHeight": "100vh", "padding": "0 16px"})


# ════════════════════════════════════════════════════════════════════════════
# CALLBACKS
# ════════════════════════════════════════════════════════════════════════════

@app.callback(
    Output("data-store", "data"),
    Output("last-updated", "children"),
    Input("refresh-interval", "n_intervals"),
    Input("country-select", "value"),
)
def refresh_data(_, _country):
    """Load all country data on each refresh cycle."""
    _, df = load_all_data()
    timestamp = datetime.now().strftime("Updated %H:%M:%S")
    return df.to_json(date_format="iso", orient="records"), timestamp


@app.callback(
    Output("kpi-row", "children"),
    Input("data-store", "data"),
    Input("country-select", "value"),
)
def update_kpis(json_data, selected_iso2):
    if not json_data:
        return []
    df = pd.read_json(io.StringIO(json_data), orient="records")

    # ── Regional summary row (only countries with live WM scores) ────────────
    scored = df[df["score"].notna()]
    n_live = len(scored)
    n_total = len(df)
    avg_score     = round(scored["score"].mean(), 1) if n_live else None
    most_unstable = scored.loc[scored["score"].idxmax()] if n_live else None
    best_row      = scored.dropna(subset=["delta_30d"])
    worst_30d_row = best_row.loc[best_row["delta_30d"].idxmax()] if not best_row.empty else None
    best_30d_row  = best_row.loc[best_row["delta_30d"].idxmin()] if not best_row.empty else None

    regional_cards = [
        kpi_card("Tracked Countries", f"{n_live}/{n_total}",
                 "with live WM scores", CLR["accent"], 2),
        kpi_card("Regional Average",
                 f"{avg_score}" if avg_score is not None else "N/A",
                 "WorldMonitor composite", score_color(avg_score), 2),
        kpi_card("Most Unstable",
                 most_unstable["name"] if most_unstable is not None else "N/A",
                 f"Score: {most_unstable['score']:.0f}" if most_unstable is not None else "",
                 score_color(most_unstable["score"] if most_unstable is not None else None), 3),
        kpi_card(
            "Largest 30d Increase",
            worst_30d_row["name"] if worst_30d_row is not None else "—",
            f"+{worst_30d_row['delta_30d']:.1f} pts" if worst_30d_row is not None else "",
            CLR["critical"], 2,
        ),
        kpi_card(
            "Largest 30d Improvement",
            best_30d_row["name"] if best_30d_row is not None else "—",
            f"{best_30d_row['delta_30d']:.1f} pts" if best_30d_row is not None else "",
            CLR["stable"], 3,
        ),
    ]

    # ── Country focus row (shown when a country is selected) ─────────────────
    sel_row = df[df["iso2"] == selected_iso2]
    if sel_row.empty or not selected_iso2:
        return regional_cards

    r       = sel_row.iloc[0]
    d7      = r.get("delta_7d")
    d30     = r.get("delta_30d")
    sc      = score_color(r["score"])

    def fmt_d(v):
        if _is_null(v): return "—"
        return f"+{v:.1f}" if v > 0 else f"{v:.1f}"

    country_banner = dbc.Col(
        html.Div([
            html.Span("▶ SELECTED: ", style={"color": CLR["muted"], "fontSize": "9px",
                                              "letterSpacing": "0.1em"}),
            html.Span(ME_COUNTRIES[selected_iso2]["name"].upper(),
                      style={"color": sc, "fontSize": "9px", "fontWeight": "700",
                             "letterSpacing": "0.1em", "fontFamily": "JetBrains Mono, monospace"}),
            dbc.Row([
                dbc.Col(metric_tile("Score", f"{r['score']:.0f}" if r['score'] is not None and not (isinstance(r['score'], float) and pd.isna(r['score'])) else "N/A", sc), width=3),
                dbc.Col(metric_tile("Band",        r.get("score_band","—"), sc),           width=3),
                dbc.Col(metric_tile("7d Change",   fmt_d(d7),  delta_color(d7)),           width=2),
                dbc.Col(metric_tile("30d Change",  fmt_d(d30), delta_color(d30)),          width=2),
                dbc.Col(metric_tile("Rank",        f"#{int(r['rank'])} / {len(df)}" if not _is_null(r.get('rank')) else "— / {}".format(len(df)),
                                    CLR["muted"]),                                         width=2),
            ], className="g-2 mt-2"),
        ], style={"background": CLR["panel"], "border": f"1px solid {sc}",
                  "borderRadius": "8px", "padding": "10px 14px"}),
        width=12,
    )

    return [dbc.Col(dbc.Row(regional_cards, className="g-2"), width=12),
            dbc.Col(html.Hr(style={"borderColor": CLR["border"], "margin": "6px 0"}), width=12),
            country_banner]


@app.callback(
    Output("region-map", "figure"),
    Output("bar-chart",  "figure"),
    Input("data-store",  "data"),
    Input("country-select", "value"),
)
def update_visuals(json_data, selected):
    if not json_data:
        empty = go.Figure()
        empty.update_layout(paper_bgcolor=CLR["panel"], plot_bgcolor=CLR["panel"])
        return empty, empty

    df = pd.read_json(io.StringIO(json_data), orient="records")
    return build_map(df, selected), build_bar_chart(df, selected)


# iso3 → iso2 lookup for choropleth click handling
_ISO3_TO_ISO2 = {meta["iso3"]: iso2 for iso2, meta in ME_COUNTRIES.items()}


@app.callback(
    Output("country-select", "value"),
    Input("region-map", "clickData"),
    State("country-select", "value"),
    prevent_initial_call=True,
)
def handle_map_click(map_click, current):
    """Update dropdown when user clicks a country dot or fill on the map."""
    if map_click:
        try:
            point = map_click["points"][0]
            # Scattergeo dot click — has customdata with iso2
            if "customdata" in point:
                iso2 = point["customdata"][0]
                if iso2 in ME_COUNTRIES:
                    return iso2
            # Choropleth fill click — has location with iso3
            if "location" in point:
                iso2 = _ISO3_TO_ISO2.get(point["location"])
                if iso2:
                    return iso2
        except (KeyError, IndexError):
            pass
    return current


@app.callback(
    Output("drilldown-metrics", "children"),
    Output("history-chart",     "figure"),
    Output("narrative-box",     "children"),
    Input("country-select",     "value"),
    Input("data-store",         "data"),
)
def update_drilldown(iso2, json_data):
    def _empty():
        fig = go.Figure()
        fig.update_layout(paper_bgcolor=CLR["panel"], plot_bgcolor=CLR["bg"],
                          margin=dict(l=10, r=10, t=30, b=10))
        return html.Div(), fig, html.Div()

    if not json_data or not iso2:
        return _empty()

    try:
        df = pd.read_json(io.StringIO(json_data), orient="records")
    except Exception as e:
        print(f"[drilldown] JSON parse error: {e}")
        return _empty()

    row = df[df["iso2"] == iso2]
    if row.empty:
        return _empty()

    row   = row.iloc[0].to_dict()
    score = row["score"]
    name  = ME_COUNTRIES[iso2]["name"]
    has_score = score is not None and not (isinstance(score, float) and pd.isna(score))

    # If no live score, show N/A panel
    if not has_score:
        no_data = html.Div(
            f"No live WorldMonitor score available for {name}.",
            style={"color": CLR["muted"], "fontSize": "12px", "padding": "12px 0"},
        )
        fig = go.Figure()
        fig.update_layout(paper_bgcolor=CLR["panel"], plot_bgcolor=CLR["bg"],
                          margin=dict(l=10, r=10, t=30, b=10))
        return no_data, fig, no_data

    # History + analytics (only when score is known)
    hist      = get_country_history(iso2, score)
    analytics = compute_history_analytics(hist)

    def fmt_delta(v):
        if _is_null(v): return "—"
        return f"+{v:.1f}" if v > 0 else f"{v:.1f}"

    band_color = score_color(score)
    dc_7  = delta_color(row.get("delta_7d"))
    dc_30 = delta_color(row.get("delta_30d"))
    rank_val = row.get("rank")
    rank_str = f"#{int(rank_val)}" if rank_val is not None and not (isinstance(rank_val, float) and pd.isna(rank_val)) else "—"

    metrics = dbc.Row([
        dbc.Col(metric_tile("Score",       f"{score:.0f}",                   band_color), width=6),
        dbc.Col(metric_tile("Band",        row.get("score_band", "—"),       band_color), width=6),
        dbc.Col(metric_tile("7d Change",   fmt_delta(row.get("delta_7d")),   dc_7),       width=6),
        dbc.Col(metric_tile("30d Change",  fmt_delta(row.get("delta_30d")),  dc_30),      width=6),
        dbc.Col(metric_tile("180d Change", fmt_delta(row.get("delta_180d")), CLR["muted"]), width=6),
        dbc.Col(metric_tile("Rank",        f"{rank_str} / {len(df)}", CLR["muted"]), width=6),
        dbc.Col(metric_tile("Trend",       row.get("trend_label", "—"),      CLR["accent"]), width=12),
    ], className="g-2 mt-1")

    chart = build_history_chart(analytics, name, score)

    narrative_text = generate_narrative(name, score, row, analytics)
    n_readings = len(hist)
    mock_note = html.P(
        f"History: {n_readings} WorldMonitor reading(s) recorded locally. "
        "Chart grows in real-time as the dashboard polls WorldMonitor.",
        style={"fontSize": "9px", "color": CLR["muted"], "marginTop": "8px",
               "fontStyle": "italic", "borderTop": f"1px solid {CLR['border']}",
               "paddingTop": "6px"},
    )

    narrative = html.Div([
        html.Div(narrative_text, className="summary-box"),
        mock_note,
    ])

    return metrics, chart, narrative


@app.callback(
    Output("alerts-panel",  "children"),
    Input("data-store",     "data"),
    Input("country-select", "value"),
)
def update_alerts(json_data, selected_iso2):
    if not json_data:
        return html.Div("No data", style={"color": CLR["muted"]})

    df     = pd.read_json(io.StringIO(json_data), orient="records")
    alerts = detect_regional_alerts(df)

    # Filter to selected country if one is chosen
    if selected_iso2:
        country_alerts = [a for a in alerts if a["iso2"] == selected_iso2]
        header = html.P(
            f"{ME_COUNTRIES.get(selected_iso2, {}).get('name', selected_iso2)} — specific alerts",
            style={"fontSize": "9px", "color": CLR["muted"], "marginBottom": "8px",
                   "fontStyle": "italic"},
        )
        alerts = country_alerts
    else:
        header = html.Span()

    if not alerts:
        msg = ("No alerts for this country in the current cycle."
               if selected_iso2 else "No significant movements detected in the current cycle.")
        return html.Div([header, html.Div(msg, style={"color": CLR["muted"], "fontSize": "11px"})])

    items = [header]
    for a in alerts[:8]:
        cls   = f"alert-item alert-{a['severity']}"
        color = {"high": CLR["critical"], "medium": CLR["high"], "low": CLR["stable"]}[a["severity"]]
        items.append(html.Div([
            html.Span(f"{a['icon']} ", style={"marginRight": "4px"}),
            html.Span(a["country"],    style={"color": color, "fontWeight": "600"}),
            html.Span(f"  {a['message']}", style={"color": CLR["text"]}),
        ], className=cls))

    return items


@app.callback(
    Output("ucdp-panel", "children"),
    Input("country-select", "value"),
)
def update_ucdp_panel(iso2):
    if not iso2:
        return html.Div("Select a country to see conflict events.",
                        style={"color": CLR["muted"], "fontSize": "11px"})

    name = ME_COUNTRIES[iso2]["name"]
    all_events = fetch_ucdp_events()
    events = [e for e in all_events if e.get("country") == name]

    if not events:
        return html.Div(
            f"No UCDP conflict events recorded for {name} in the current WorldMonitor dataset.",
            style={"color": CLR["muted"], "fontSize": "11px"},
        )

    VIOLENCE_LABEL = {
        "UCDP_VIOLENCE_TYPE_STATE_BASED":    "State-based",
        "UCDP_VIOLENCE_TYPE_NON_STATE":      "Non-state",
        "UCDP_VIOLENCE_TYPE_ONE_SIDED":      "One-sided",
    }

    rows = []
    for e in sorted(events, key=lambda x: x.get("dateStart", 0), reverse=True)[:50]:
        date_ms = e.get("dateStart") or e.get("dateEnd") or 0
        date_str = datetime.fromtimestamp(date_ms / 1000).strftime("%Y-%m-%d") if date_ms else "—"
        deaths = e.get("deathsBest")
        death_str = str(int(deaths)) if deaths is not None else "—"
        vtype = VIOLENCE_LABEL.get(e.get("violenceType", ""), e.get("violenceType", "—"))
        side_a = e.get("sideA", "—")
        side_b = e.get("sideB", "—")
        rows.append({
            "Date":         date_str,
            "Type":         vtype,
            "Side A":       side_a,
            "Side B":       side_b,
            "Deaths (est)": death_str,
        })

    total_deaths = sum(
        int(e["deathsBest"]) for e in events if e.get("deathsBest") is not None
    )
    summary = html.P(
        f"{name} — {len(events)} UCDP events found  |  "
        f"Total deaths (est): {total_deaths:,}  |  "
        f"Showing most recent 50",
        style={"fontSize": "10px", "color": CLR["muted"], "marginBottom": "8px"},
    )

    table = dash_table.DataTable(
        data=rows,
        columns=[{"name": c, "id": c} for c in rows[0].keys()],
        style_table={"overflowX": "auto"},
        style_cell={"textAlign": "left", "padding": "6px 10px",
                    "fontFamily": "JetBrains Mono, monospace", "fontSize": "11px"},
        style_header={"fontWeight": "700", "fontSize": "10px",
                      "textTransform": "uppercase", "letterSpacing": "0.08em"},
        page_size=15,
        sort_action="native",
    )

    return html.Div([summary, table])


@app.callback(
    Output("live-intel-panel", "children"),
    Input("country-select", "value"),
)
def update_live_intel(iso2):
    if not iso2:
        return html.Div("Select a country.", style={"color": CLR["muted"], "fontSize": "11px"})

    name = ME_COUNTRIES.get(iso2, {}).get("name", iso2)
    data = fetch_wm_live(iso2)

    if data.get("error"):
        return html.Div(
            f"Could not load live data: {data['error']}",
            style={"color": CLR["muted"], "fontSize": "11px"},
        )

    score = data.get("cii_score")
    comps = data.get("components", {})
    brief = data.get("brief", "")
    signals = data.get("signals", [])

    # Score row
    if score is not None:
        band_color = score_color(score)
        score_block = dbc.Row([
            dbc.Col(metric_tile("WM Live Score", str(score), band_color), width=3),
            dbc.Col(metric_tile("Unrest",    str(comps.get("Unrest",    "—")), CLR["high"]),     width=2),
            dbc.Col(metric_tile("Conflict",  str(comps.get("Conflict",  "—")), CLR["critical"]), width=2),
            dbc.Col(metric_tile("Security",  str(comps.get("Security",  "—")), CLR["medium"]),   width=2),
            dbc.Col(metric_tile("Info Vel.", str(comps.get("Information","—")), CLR["accent"]),  width=3),
        ], className="g-2 mb-3")
    else:
        score_block = html.Div("Score not available.", style={"color": CLR["muted"]})

    # Active signals chips
    signal_chips = html.Div(
        [html.Span(s, style={
            "display": "inline-block", "margin": "2px 4px",
            "padding": "3px 8px", "borderRadius": "12px",
            "background": CLR["panel"], "border": f"1px solid {CLR['border']}",
            "fontSize": "11px", "color": CLR["text"],
        }) for s in signals] if signals else
        [html.Span("No active signals.", style={"color": CLR["muted"], "fontSize": "11px"})],
        style={"marginBottom": "10px"},
    )

    # Intelligence brief
    brief_block = html.Div(
        brief or "No intelligence brief available.",
        style={"fontSize": "11px", "color": CLR["text"],
               "whiteSpace": "pre-wrap", "lineHeight": "1.6"},
    )

    source_note = html.P(
        "Source: worldmonitor.app (live scrape)",
        style={"fontSize": "9px", "color": CLR["muted"], "marginTop": "10px",
               "fontStyle": "italic"},
    )

    return html.Div([
        html.H6(f"{name} — Live Instability Data",
                style={"color": CLR["accent"], "fontSize": "12px", "marginBottom": "10px"}),
        score_block,
        html.Div("Active Signals", style={"fontSize": "10px", "color": CLR["muted"],
                                          "textTransform": "uppercase", "letterSpacing": "0.08em",
                                          "marginBottom": "4px"}),
        signal_chips,
        html.Div("Intelligence Brief", style={"fontSize": "10px", "color": CLR["muted"],
                                              "textTransform": "uppercase", "letterSpacing": "0.08em",
                                              "marginBottom": "4px"}),
        brief_block,
        source_note,
    ])


# ════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "═" * 68)
    print("  MIDDLE EAST INSTABILITY MONITOR")
    print(f"  Dashboard: http://localhost:8050")
    print(f"  Proxy API: {PROXY_BASE}")
    print(f"  Countries: {len(ME_COUNTRIES)}")
    print(f"  History:   {HISTORY_DAYS} days")
    print("═" * 68 + "\n")
    app.run(debug=False, port=8050, host="0.0.0.0")
