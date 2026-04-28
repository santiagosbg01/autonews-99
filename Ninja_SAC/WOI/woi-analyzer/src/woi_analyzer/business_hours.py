"""
Cálculo de tiempo dentro de horario laboral (business hours).

WOI mide TTFR (Time To First Response) y TTR (Time To Resolution) **solo durante
horas laborales** del timezone del grupo. Esto evita que tickets abiertos a las
11pm y respondidos a las 9am se cuenten como "10 horas de espera" cuando en
realidad operacionalmente la espera fue 0 (todo el gap fue fuera de horario).

Defaults: 09:00 a 20:00 hora local (inclusive el inicio, exclusive el fin).
Configurable vía env:
- BUSINESS_HOUR_START   (int 0-23, default 9)
- BUSINESS_HOUR_END     (int 1-24, default 20)
- BUSINESS_DAYS         ('weekdays' = lun-vie | 'all' = todos los días, default 'all')

V1: por simplicidad usamos la misma ventana global para todos los grupos. Si en
V1.5 necesitamos ventanas distintas por país/cliente, agregar columnas
business_hour_start/end en la tabla `groups` y leer desde ahí.
"""

from __future__ import annotations

import os
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

DEFAULT_TZ = "America/Mexico_City"


def _cfg_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        v = int(raw)
    except ValueError:
        return default
    return v if lo <= v <= hi else default


BUSINESS_HOUR_START = _cfg_int("BUSINESS_HOUR_START", 9, 0, 23)
BUSINESS_HOUR_END = _cfg_int("BUSINESS_HOUR_END", 20, 1, 24)
BUSINESS_DAYS = os.environ.get("BUSINESS_DAYS", "all").lower()  # 'all' | 'weekdays'

if BUSINESS_HOUR_END <= BUSINESS_HOUR_START:
    raise ValueError(
        f"BUSINESS_HOUR_END ({BUSINESS_HOUR_END}) debe ser > BUSINESS_HOUR_START ({BUSINESS_HOUR_START})"
    )


def _is_business_day(d: datetime) -> bool:
    """Devuelve True si la fecha cuenta como día laboral según BUSINESS_DAYS."""
    if BUSINESS_DAYS == "weekdays":
        return d.weekday() < 5  # Mon=0 … Fri=4
    return True


def _resolve_tz(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def business_seconds_between(
    start: datetime,
    end: datetime,
    tz_name: str | None = None,
) -> int:
    """
    Segundos de horario laboral entre `start` (incl) y `end` (excl), evaluados
    en la zona horaria `tz_name`.

    - Ambos timestamps pueden venir naïve (se asumen UTC) o tz-aware.
    - Si end <= start, devuelve 0.
    - Si la ventana cae completa fuera del horario laboral, devuelve 0.
    - Atraviesa días: cuenta segmentos por cada día calendario local entre
      [start, end].
    """
    if end <= start:
        return 0

    tz = _resolve_tz(tz_name)
    s = start.astimezone(tz)
    e = end.astimezone(tz)

    total = 0
    cur = s
    # Cap defensivo: 366 días (un año máximo). Tickets más viejos no deberían existir.
    safety = 0
    while cur < e and safety < 400:
        safety += 1
        day = cur.date()
        if _is_business_day(cur):
            day_start = datetime.combine(day, time(BUSINESS_HOUR_START), tzinfo=tz)
            # 24:00 = inicio del día siguiente (no existe time(24,0))
            if BUSINESS_HOUR_END == 24:
                day_end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=tz)
            else:
                day_end = datetime.combine(day, time(BUSINESS_HOUR_END), tzinfo=tz)

            overlap_start = max(cur, day_start)
            overlap_end = min(e, day_end)
            if overlap_end > overlap_start:
                total += int((overlap_end - overlap_start).total_seconds())

        # Avanzar al inicio del siguiente día local
        next_midnight = datetime.combine(day + timedelta(days=1), time(0), tzinfo=tz)
        cur = next_midnight

    return total


__all__ = [
    "BUSINESS_HOUR_START",
    "BUSINESS_HOUR_END",
    "BUSINESS_DAYS",
    "business_seconds_between",
]
