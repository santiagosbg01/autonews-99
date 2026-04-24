"""
Scheduler de producción para Railway.

- Cada hora en horario laboral (06:00–22:00 hora CDMX):
    1. run_classification_batch()   — clasifica mensajes nuevos con Haiku
    2. reconstruct_recent_incidents() — actualiza incidentes
    3. run_group_analysis_batch()   — análisis Sonnet de cada grupo

- A las 22:00 CDMX adicionalmente:
    4. run_daily_batch()            — reporte ejecutivo del día + Slack
"""

from __future__ import annotations

import signal
import sys
import time
from datetime import datetime

import pytz

from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.config import CONFIG
from woi_analyzer.daily_batch import run_daily_batch
from woi_analyzer.group_analyst import run_group_analysis_batch
from woi_analyzer.incident_reconstructor import reconstruct_recent_incidents, refresh_open_ticket_statuses
from woi_analyzer.logging_setup import log

CDMX_TZ = pytz.timezone("America/Mexico_City")
WORK_HOUR_START = 6   # 06:00 CDMX inclusive
WORK_HOUR_END   = 22  # 22:00 CDMX inclusive (se ejecuta)
DAILY_HOUR      = 22  # hora en que además corre el daily batch


def _cdmx_hour() -> int:
    return datetime.now(CDMX_TZ).hour


def _is_work_hour() -> bool:
    return WORK_HOUR_START <= _cdmx_hour() <= WORK_HOUR_END


def _run_hourly_cycle() -> None:
    now = datetime.now(CDMX_TZ)
    log.info("hourly_cycle_start", cdmx_time=now.strftime("%H:%M"))

    # 1. Classify new messages
    try:
        cls = run_classification_batch()
        log.info("classify_done", processed=cls.processed, failed=cls.failed)
    except Exception as e:
        log.error("classify_error", error=str(e))

    # 2. Reconstruct incidents + refresh open ticket statuses
    if CONFIG.analyzer.feature_incident_reconstruction:
        try:
            n = reconstruct_recent_incidents(lookback_hours=4)
            log.info("reconstruct_done", incidents=n)
        except Exception as e:
            log.error("reconstruct_error", error=str(e))
        try:
            refresh_open_ticket_statuses()
        except Exception as e:
            log.error("status_refresh_error", error=str(e))

    # 3. Sonnet group analysis (last 2h window)
    try:
        result = run_group_analysis_batch(window_hours=2)
        log.info("group_analysis_done", **result)
    except Exception as e:
        log.error("group_analysis_error", error=str(e))

    # 4. Daily batch at DAILY_HOUR
    if _cdmx_hour() == DAILY_HOUR:
        try:
            daily = run_daily_batch()
            log.info("daily_batch_done", **daily)
        except Exception as e:
            log.error("daily_batch_error", error=str(e))

    log.info("hourly_cycle_done", elapsed_sec=round(
        (datetime.now(CDMX_TZ) - now).total_seconds(), 1))


def _minutes_to_next_hour() -> float:
    """Returns seconds until the next full hour."""
    now = datetime.now(CDMX_TZ)
    secs_past = now.minute * 60 + now.second
    return max(3600 - secs_past, 60)  # at least 60s


def main() -> None:
    log.info("scheduler_start",
             work_hours=f"{WORK_HOUR_START:02d}:00–{WORK_HOUR_END:02d}:00 CDMX")

    def _handle_signal(sig, frame):
        log.info("scheduler_shutdown", signal=sig)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    # Run once immediately on startup (don't wait for the next hour)
    if _is_work_hour():
        log.info("startup_run")
        _run_hourly_cycle()

    while True:
        wait = _minutes_to_next_hour()
        log.info("sleeping_until_next_hour", seconds=round(wait))
        time.sleep(wait)

        if _is_work_hour():
            _run_hourly_cycle()
        else:
            log.info("outside_work_hours", cdmx_hour=_cdmx_hour())


if __name__ == "__main__":
    main()
