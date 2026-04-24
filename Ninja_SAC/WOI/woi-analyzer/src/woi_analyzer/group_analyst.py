"""Análisis horario de grupos con Claude Sonnet — paralelo."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from woi_analyzer.claude_client import generate_group_analysis
from woi_analyzer.db import (
    fetch_active_groups,
    fetch_messages_for_group_analysis,
    insert_group_analysis,
)
from woi_analyzer.logging_setup import log

MAX_MESSAGES_PER_GROUP = 80   # cap to keep prompts fast
MAX_PARALLEL_GROUPS    = 5    # concurrent Sonnet calls


def _analyze_one(g: dict, window_start: datetime, now: datetime, window_hours: int) -> str:
    """Analiza un grupo. Retorna 'analyzed' | 'skipped' | 'failed'."""
    group_id   = g["id"]
    group_name = g["name"]

    messages = fetch_messages_for_group_analysis(
        group_id=group_id,
        since=window_start,
        until=now,
    )

    if not messages:
        log.info("group_analysis_skipped_no_messages", group=group_name)
        return "skipped"

    # Keep only the most recent N messages to bound token usage
    if len(messages) > MAX_MESSAGES_PER_GROUP:
        messages = messages[-MAX_MESSAGES_PER_GROUP:]

    result, usage = generate_group_analysis(
        group_name=group_name,
        country=g.get("country") or "MX",
        vertical=g.get("vertical"),
        timezone=g.get("timezone") or "America/Mexico_City",
        messages=messages,
        window_hours=window_hours,
    )

    category_counts = result.pop("_category_counts", {})
    insights = {
        "key_topics":             result.get("key_topics", []),
        "anomalies":              result.get("anomalies", []),
        "recommendations":        result.get("recommendations", []),
        "dynamics":               result.get("dynamics", ""),
        "client_sentiment_label": result.get("client_sentiment_label", "neutro"),
        "risk_level":             result.get("risk_level", "bajo"),
        "risk_reason":            result.get("risk_reason"),
    }

    insert_group_analysis(
        group_id=group_id,
        window_start=window_start,
        window_end=now,
        message_count=len(messages),
        narrative=result.get("narrative", ""),
        insights=insights,
        participants_summary=result.get("participants", []),
        category_counts=category_counts,
        claude_model=result.get("claude_model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
    )

    log.info("group_analysis_done", group=group_name, messages=len(messages),
             risk=insights["risk_level"], tokens=usage.get("input_tokens", 0))
    return "analyzed"


def run_group_analysis_batch(window_hours: int = 2) -> dict:
    """
    Para cada grupo activo, analiza los últimos `window_hours` de mensajes
    con Claude Sonnet en paralelo (max 5 concurrent).
    """
    groups = fetch_active_groups()
    if not groups:
        log.info("no_active_groups_for_analysis")
        return {"analyzed": 0, "skipped": 0, "failed": 0}

    now          = datetime.now().astimezone()
    window_start = now - timedelta(hours=window_hours)

    analyzed = skipped = failed = 0

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_GROUPS) as pool:
        futures = {
            pool.submit(_analyze_one, g, window_start, now, window_hours): g["name"]
            for g in groups
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                outcome = future.result()
                if outcome == "analyzed":
                    analyzed += 1
                elif outcome == "skipped":
                    skipped += 1
                else:
                    failed += 1
            except Exception as e:
                log.error("group_analysis_failed", group=name, error=str(e))
                failed += 1

    log.info("group_analysis_batch_done", analyzed=analyzed, skipped=skipped, failed=failed)
    return {"analyzed": analyzed, "skipped": skipped, "failed": failed}
