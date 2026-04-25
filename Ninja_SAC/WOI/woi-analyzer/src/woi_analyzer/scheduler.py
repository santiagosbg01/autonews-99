"""
Scheduler de producción para Railway.

- Cada hora (24/7, escaneando todos los timezones de los grupos):
    1. run_classification_batch()       — clasifica mensajes nuevos con Haiku
    2. reconstruct_recent_incidents()   — actualiza incidentes
    3. run_group_analysis_batch()       — análisis Sonnet de cada grupo
    4. run_due_briefings()              — genera briefing por grupo cuando
                                          son las 06:xx en su zona horaria

- A las 22:00 CDMX adicionalmente:
    + run_daily_batch()                 — reporte ejecutivo del día + Slack
"""

from __future__ import annotations

import signal
import sys
import time
from datetime import datetime

import pytz

from woi_analyzer.churn_detector import scan_recent_messages as scan_churn_signals
from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.config import CONFIG
from woi_analyzer.daily_batch import run_daily_batch
from woi_analyzer.eod_resolver import run_due_eod_resolution
from woi_analyzer.group_analyst import run_group_analysis_batch
from woi_analyzer.incident_reconstructor import reconstruct_recent_incidents, refresh_open_ticket_statuses
from woi_analyzer.logging_setup import log
from woi_analyzer.morning_briefing import run_due_briefings

CDMX_TZ = pytz.timezone("America/Mexico_City")
WORK_HOUR_START = 6   # 06:00 CDMX inclusive (window where we still classify)
WORK_HOUR_END   = 22  # 22:00 CDMX inclusive (window where we still classify)
DAILY_HOUR      = 22  # hora en que además corre el daily batch
BRIEFING_HOUR   = 6   # hora local de cada grupo en la que se dispara su briefing
EOD_HOUR        = 23  # hora local de cada grupo en la que se cierran tickets abiertos


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

    # 3.5 Churn-risk keyword scan (last 4h client/operations messages)
    try:
        churn = scan_churn_signals(lookback_hours=4)
        if churn.get("saved", 0) > 0:
            log.info("churn_scan_done", **churn)
    except Exception as e:
        log.error("churn_scan_error", error=str(e))

    # 4. Morning briefing — runs per-group at 06:xx local time of each group.
    #    Since groups span MX/PE/CL/CO timezones, we check on every hourly tick.
    try:
        mb_results = run_due_briefings(briefing_hour=BRIEFING_HOUR)
        if mb_results:
            log.info(
                "morning_briefing_batch_done",
                generated=len(mb_results),
                groups=[r.get("group") for r in mb_results],
            )
    except Exception as e:
        log.error("morning_briefing_error", error=str(e))

    # 4.5 End-of-day resolution sweep — runs per-group at 23:xx local time.
    #     Forces a verdict (resuelto / no_resuelto_eod) on every still-open
    #     ticket so we don't carry unresolved complaints into the next day.
    try:
        eod_results = run_due_eod_resolution(eod_hour=EOD_HOUR)
        if eod_results:
            log.info(
                "eod_resolution_batch_done",
                groups=len(eod_results),
                total_open=sum(r.get("open_at_eod", 0) for r in eod_results),
                resolved=sum(r.get("resolved", 0) for r in eod_results),
                unresolved=sum(r.get("unresolved", 0) for r in eod_results),
            )
    except Exception as e:
        log.error("eod_resolution_error", error=str(e))

    # 5. Daily batch at DAILY_HOUR
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
    log.info("startup_run")
    _run_hourly_cycle()

    while True:
        wait = _minutes_to_next_hour()
        log.info("sleeping_until_next_hour", seconds=round(wait))
        time.sleep(wait)
        # We always run the hourly cycle now (briefings can fire at 06:xx in
        # any timezone, including outside CDMX work hours).
        _run_hourly_cycle()


if __name__ == "__main__":
    main()
