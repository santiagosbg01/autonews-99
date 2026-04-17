"""Orquestador del reporte diario: query → narrativa Sonnet → Sheet → Slack → log."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import structlog

from woi_analyzer.claude_client import generate_daily_summary
from woi_reporter.config import CFG
from woi_reporter.queries import (
    fetch_agent_leaderboard,
    fetch_agents_red_zone,
    fetch_daily_overview,
    fetch_groups_health,
    fetch_haiku_consistency_today,
    fetch_haiku_sonnet_diffs,
    fetch_open_incidents,
    fetch_raw_sample,
    upsert_daily_report_log,
)
from woi_reporter.sheets_writer import write_report
from woi_reporter.slack_notifier import build_message, post_to_slack

log = structlog.get_logger()


def run_daily_report(for_date: str | None = None) -> dict:
    """Ejecuta el flujo completo para la fecha dada (default = hoy en CDMX)."""
    tz = ZoneInfo(CFG.timezone)
    if for_date:
        report_date = datetime.fromisoformat(for_date).date()
    else:
        report_date = datetime.now(tz).date()

    log.info("daily_report_start", report_date=report_date.isoformat())

    overview = fetch_daily_overview(report_date)
    groups = fetch_groups_health(report_date)
    incidents = fetch_open_incidents(limit=CFG.top_incidents)
    agents_red = fetch_agents_red_zone(ttfr_threshold_min=30, days=7)
    agents_lb = fetch_agent_leaderboard(days=7)
    raw_sample = fetch_raw_sample(report_date, limit=20)
    diffs = fetch_haiku_sonnet_diffs(report_date, limit=10)
    consistency = fetch_haiku_consistency_today(report_date)

    groups_at_risk = [g for g in groups if (g.get("ratio_b_pct") or 0) > 25]

    # Narrativa Sonnet
    narrative = ""
    if overview.get("total", 0) > 0:
        try:
            narrative = generate_daily_summary(
                {
                    "date": report_date.isoformat(),
                    "overview": overview,
                    "groups_at_risk": groups_at_risk[:10],
                    "top_incidents": incidents[:10],
                    "agents_red_zone": agents_red[:10],
                    "consistency": consistency,
                }
            )
        except Exception as e:
            log.error("sonnet_narrative_failed", error=str(e))
            narrative = f"(narrativa no generada: {e})"

    sheet_url = write_report(
        report_date=report_date,
        overview=overview,
        incidents=incidents,
        agents_red=agents_red,
        agents_leaderboard=agents_lb,
        groups_health=groups,
        raw_sample=raw_sample,
        diffs=diffs,
        consistency=consistency,
        narrative=narrative,
    )
    log.info("sheet_updated", url=sheet_url)

    payload = build_message(
        report_date=report_date,
        overview=overview,
        sheet_url=sheet_url,
        groups_at_risk=groups_at_risk,
        top_incidents=incidents,
        agents_red=agents_red,
        consistency=consistency,
    )
    delivered = post_to_slack(payload)
    log.info("slack_posted", delivered=delivered)

    upsert_daily_report_log(
        report_date=report_date,
        overview=overview,
        incidents=incidents,
        agents_red=agents_red,
        groups_at_risk=groups_at_risk,
        narrative=narrative,
        consistency=consistency,
        sheet_url=sheet_url,
    )

    return {
        "report_date": report_date.isoformat(),
        "total_messages": overview.get("total", 0),
        "ratio_b_pct": overview.get("ratio_b_pct"),
        "open_incidents": len(incidents),
        "agents_red_zone": len(agents_red),
        "sheet_url": sheet_url,
        "slack_delivered": delivered,
        "haiku_consistency_pct": consistency.get("consistency_pct"),
    }


if __name__ == "__main__":
    run_daily_report()
