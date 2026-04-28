"""
Cálculo de tiempo dentro de horario laboral (business hours).

WOI mide TTFR (Time To First Response) y TTR (Time To Resolution) **solo durante
horas laborales** del timezone del grupo. Esto evita que tickets abiertos a las
11pm y respondidos a las 9am se cuenten como "10 horas de espera" cuando en
realidad operacionalmente la espera fue 0 (todo el gap fue fuera de horario).

Cada grupo configura su propia ventana laboral en la tabla `groups` (columnas
`business_hour_start`, `business_hour_end`, `business_days`). Cuando el caller
no provee esos valores explícitos, se cae en los defaults globales del env.

Defaults globales (env-overridable, sirven como fallback / seed):
- BUSINESS_HOUR_START   (int 0-23, default 9)
- BUSINESS_HOUR_END     (int 1-24, default 20)
- BUSINESS_DAYS         ('all' = los 7 días | 'weekdays' = lun-vie, default 'all')
"""

from __future__ import annotations

import os
from datetime import datetime, time, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

DEFAULT_TZ = "America/Mexico_City"

_DAY_TOKENS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_DAY_INDEX = {d: i for i, d in enumerate(_DAY_TOKENS)}


def _cfg_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        v = int(raw)
    except ValueError:
        return default
    return v if lo <= v <= hi else default


DEFAULT_HOUR_START = _cfg_int("BUSINESS_HOUR_START", 9, 0, 23)
DEFAULT_HOUR_END = _cfg_int("BUSINESS_HOUR_END", 20, 1, 24)
_DEFAULT_DAYS_RAW = os.environ.get("BUSINESS_DAYS", "all").lower()
if _DEFAULT_DAYS_RAW == "weekdays":
    DEFAULT_DAYS: frozenset[int] = frozenset(range(0, 5))  # Mon..Fri
else:
    DEFAULT_DAYS = frozenset(range(0, 7))

# Aliases backward-compat — código que importa BUSINESS_HOUR_START/END/DAYS sigue
# funcionando, pero ahora son los DEFAULTS globales (no la única fuente de verdad).
BUSINESS_HOUR_START = DEFAULT_HOUR_START
BUSINESS_HOUR_END = DEFAULT_HOUR_END
BUSINESS_DAYS = _DEFAULT_DAYS_RAW

if DEFAULT_HOUR_END <= DEFAULT_HOUR_START:
    raise ValueError(
        f"BUSINESS_HOUR_END ({DEFAULT_HOUR_END}) debe ser > BUSINESS_HOUR_START ({DEFAULT_HOUR_START})"
    )


def _normalize_days(days: Iterable[str] | None) -> frozenset[int]:
    """Convierte ['mon','wed','fri'] → frozenset({0,2,4}). Si None/vacio, devuelve DEFAULT_DAYS."""
    if not days:
        return DEFAULT_DAYS
    out: set[int] = set()
    for d in days:
        if not d:
            continue
        idx = _DAY_INDEX.get(d.lower().strip()[:3])
        if idx is not None:
            out.add(idx)
    return frozenset(out) if out else DEFAULT_DAYS


def _resolve_tz(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def business_seconds_between(
    start: datetime,
    end: datetime,
    tz_name: str | None = None,
    *,
    hour_start: int | None = None,
    hour_end: int | None = None,
    days: Iterable[str] | None = None,
) -> int:
    """
    Segundos de horario laboral entre `start` (incl) y `end` (excl), evaluados
    en la zona horaria `tz_name`.

    Parámetros opcionales `hour_start`, `hour_end`, `days` permiten override
    por llamada (típicamente leídos de la tabla `groups`). Si son None, se usan
    los defaults globales del env (DEFAULT_HOUR_START/END/DAYS).

    - Ambos timestamps pueden venir naïve (se asumen UTC) o tz-aware.
    - Si end <= start, devuelve 0.
    - Si la ventana cae completa fuera del horario laboral, devuelve 0.
    """
    if end <= start:
        return 0

    hs = hour_start if hour_start is not None else DEFAULT_HOUR_START
    he = hour_end if hour_end is not None else DEFAULT_HOUR_END
    if he <= hs:
        # Configuración inválida del grupo — fallback a defaults globales.
        hs, he = DEFAULT_HOUR_START, DEFAULT_HOUR_END

    active_days = _normalize_days(days)

    tz = _resolve_tz(tz_name)
    s = start.astimezone(tz)
    e = end.astimezone(tz)

    total = 0
    cur = s
    safety = 0
    # Cap defensivo: 366 días (un año máximo). Tickets más viejos no deberían existir.
    while cur < e and safety < 400:
        safety += 1
        day = cur.date()
        if day.weekday() in active_days:
            day_start = datetime.combine(day, time(hs), tzinfo=tz)
            if he == 24:
                day_end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=tz)
            else:
                day_end = datetime.combine(day, time(he), tzinfo=tz)

            overlap_start = max(cur, day_start)
            overlap_end = min(e, day_end)
            if overlap_end > overlap_start:
                total += int((overlap_end - overlap_start).total_seconds())

        next_midnight = datetime.combine(day + timedelta(days=1), time(0), tzinfo=tz)
        cur = next_midnight

    return total


__all__ = [
    "DEFAULT_HOUR_START",
    "DEFAULT_HOUR_END",
    "DEFAULT_DAYS",
    "BUSINESS_HOUR_START",
    "BUSINESS_HOUR_END",
    "BUSINESS_DAYS",
    "business_seconds_between",
]
