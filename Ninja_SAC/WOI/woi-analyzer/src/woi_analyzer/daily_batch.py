"""Job principal del batch diario: clasifica + reconstruye incidents + calcula consistencia + genera reporte."""

from __future__ import annotations

from datetime import datetime

from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.claude_client import generate_daily_summary
from woi_analyzer.config import CONFIG
from woi_analyzer.db import compute_haiku_consistency, fetch_daily_report_input, insert_daily_report
from woi_analyzer.incident_reconstructor import reconstruct_recent_incidents
from woi_analyzer.kpi_snapshotter import run_kpi_snapshot
from woi_analyzer.logging_setup import log
from woi_analyzer.slack import alert_daily_red_zone


def run_daily_batch() -> dict:
    started = datetime.now().astimezone()
    log.info("daily_batch_start", timestamp=started.isoformat())

    cls = run_classification_batch()

    incidents_touched = 0
    if CONFIG.analyzer.feature_incident_reconstruction:
        incidents_touched = reconstruct_recent_incidents(lookback_hours=96)

    consistency = compute_haiku_consistency(days=1)

    ended = datetime.now().astimezone()
    duration_sec = (ended - started).total_seconds()

    # Gather data for daily report
    report_input = fetch_daily_report_input(started)

    # Slack alert for red-zone agents
    if report_input.get("agents_red_zone"):
        alert_daily_red_zone(report_input["agents_red_zone"])

    # Generate Sonnet narrative
    narrative = ""
    try:
        narrative_input = {
            **report_input,
            "haiku_consistency_pct": round(consistency, 2) if consistency is not None else None,
            "messages_processed": cls.processed,
            "messages_failed": cls.failed,
        }
        narrative = generate_daily_summary(narrative_input)
        log.info("daily_narrative_generated", chars=len(narrative))
    except Exception as e:
        log.warning("daily_narrative_failed", error=str(e))

    # KPI snapshots per group
    try:
        snap = run_kpi_snapshot(day=started)
        log.info("kpi_snapshots_done", **snap)
    except Exception as e:
        log.warning("kpi_snapshots_failed", error=str(e))

    # Persist to daily_reports
    try:
        insert_daily_report(
            report_date=started,
            data=report_input,
            narrative=narrative,
            haiku_consistency_pct=round(consistency, 2) if consistency is not None else None,
        )
        log.info("daily_report_saved", date=started.strftime("%Y-%m-%d"))
    except Exception as e:
        log.warning("daily_report_save_failed", error=str(e))

    summary = {
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "duration_sec": round(duration_sec, 1),
        "messages_processed": cls.processed,
        "messages_failed": cls.failed,
        "ground_truth_sampled": cls.ground_truth_sampled,
        "incidents_touched": incidents_touched,
        "haiku_consistency_pct": round(consistency, 2) if consistency is not None else None,
        "narrative_chars": len(narrative),
    }
    log.info("daily_batch_done", **summary)
    return summary


if __name__ == "__main__":
    run_daily_batch()
