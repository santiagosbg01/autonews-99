"""Job principal del batch diario: clasifica + reconstruye incidents + calcula consistencia."""

from __future__ import annotations

from datetime import datetime

from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.config import CONFIG
from woi_analyzer.db import compute_haiku_consistency
from woi_analyzer.incident_reconstructor import reconstruct_recent_incidents
from woi_analyzer.logging_setup import log


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

    summary = {
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "duration_sec": round(duration_sec, 1),
        "messages_processed": cls.processed,
        "messages_failed": cls.failed,
        "ground_truth_sampled": cls.ground_truth_sampled,
        "incidents_touched": incidents_touched,
        "haiku_consistency_pct": round(consistency, 2) if consistency is not None else None,
    }
    log.info("daily_batch_done", **summary)
    return summary


if __name__ == "__main__":
    run_daily_batch()
