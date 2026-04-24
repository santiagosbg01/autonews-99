"""Genera snapshots diarios de KPIs por grupo."""

from __future__ import annotations

from datetime import datetime

from woi_analyzer.db import (
    compute_group_kpis_for_date,
    fetch_active_groups,
    fetch_latest_group_analysis,
    upsert_group_kpi_snapshot,
)
from woi_analyzer.logging_setup import log


def run_kpi_snapshot(day: datetime | None = None) -> dict:
    """
    Para cada grupo activo, calcula y guarda el snapshot de KPIs del día `day`
    (por defecto hoy). Extrae el risk_level del último análisis Sonnet disponible.
    """
    groups = fetch_active_groups()
    if not groups:
        return {"saved": 0, "failed": 0}

    target_day = day or datetime.now().astimezone()
    saved = failed = 0

    for g in groups:
        group_id   = g["id"]
        group_name = g["name"]
        try:
            kpis = compute_group_kpis_for_date(group_id, target_day)

            # Pull risk_level and anomaly_count from latest Sonnet analysis
            latest = fetch_latest_group_analysis(group_id)
            risk_level    = latest["insights"].get("risk_level")    if latest and latest.get("insights") else None
            anomaly_count = len(latest["insights"].get("anomalies", [])) if latest and latest.get("insights") else 0

            upsert_group_kpi_snapshot(
                group_id=group_id,
                snapshot_date=target_day,
                client_sentiment_avg=kpis["client_sentiment_avg"],
                overall_sentiment_avg=kpis["overall_sentiment_avg"],
                total_messages=kpis["total_messages"],
                bucket_a=kpis["bucket_a"],
                bucket_b=kpis["bucket_b"],
                bucket_c=kpis["bucket_c"],
                incidents_opened=kpis["incidents_opened"],
                incidents_closed=kpis["incidents_closed"],
                avg_ttfr_seconds=kpis["avg_ttfr_seconds"],
                avg_ttr_seconds=kpis["avg_ttr_seconds"],
                p90_ttfr_seconds=kpis["p90_ttfr_seconds"],
                risk_level=risk_level,
                anomaly_count=anomaly_count,
            )
            log.info("kpi_snapshot_saved", group=group_name,
                     msgs=kpis["total_messages"], risk=risk_level,
                     client_sentiment=kpis["client_sentiment_avg"])
            saved += 1
        except Exception as e:
            log.error("kpi_snapshot_failed", group=group_name, error=str(e))
            failed += 1

    log.info("kpi_snapshot_batch_done", saved=saved, failed=failed,
             date=target_day.strftime("%Y-%m-%d"))
    return {"saved": saved, "failed": failed}
