"""Orquestador de clasificación Haiku + ground-truth Sonnet + persistencia."""

from __future__ import annotations

import random
from dataclasses import dataclass

from woi_analyzer.claude_client import classify_message
from woi_analyzer.config import CONFIG
from woi_analyzer.db import (
    MessageRow,
    fetch_context_messages,
    fetch_unanalyzed_messages,
    insert_ground_truth_sample,
    mark_messages_analyzed,
    upsert_analysis,
)
from woi_analyzer.logging_setup import log


@dataclass
class BatchResult:
    processed: int
    failed: int
    ground_truth_sampled: int


def _classify_and_persist(msg: MessageRow) -> tuple[bool, dict | None]:
    """
    Clasifica con Haiku y persiste a analysis.
    Devuelve (success, haiku_payload_dict_for_groundtruth).
    """
    context = fetch_context_messages(
        group_id=msg.group_id,
        before=msg.timestamp,
        n=CONFIG.analyzer.context_messages,
    )
    try:
        result, raw, usage = classify_message(
            group_name=msg.group_name,
            country="MX",  # TODO: derivar de groups.country
            timezone=msg.group_timezone,
            sender_role=msg.sender_role or "otro",
            sender_phone=msg.sender_phone,
            timestamp=msg.timestamp.isoformat(),
            context_messages=context,
            message_content=msg.content or "",
            use_sonnet=False,
        )
    except Exception as e:
        log.error("haiku_classify_failed", msg_id=msg.id, error=str(e))
        return False, None

    upsert_analysis(
        message_id=msg.id,
        category=result.category,
        bucket=result.bucket,
        sentiment=result.sentiment,
        urgency=result.urgency,
        is_incident_open=result.is_incident_open,
        is_incident_close=result.is_incident_close,
        claude_model=CONFIG.anthropic.haiku_model,
        claude_usage=usage,
        claude_raw=raw,
        reasoning=result.reasoning,
    )
    return True, {
        "category": result.category,
        "bucket": result.bucket,
        "sentiment": result.sentiment,
        "context": context,
    }


def _sample_with_sonnet(msg: MessageRow, haiku_payload: dict) -> bool:
    """Clasifica con Sonnet para crear una ground_truth_sample."""
    try:
        result, _raw, _usage = classify_message(
            group_name=msg.group_name,
            country="MX",
            timezone=msg.group_timezone,
            sender_role=msg.sender_role or "otro",
            sender_phone=msg.sender_phone,
            timestamp=msg.timestamp.isoformat(),
            context_messages=haiku_payload["context"],
            message_content=msg.content or "",
            use_sonnet=True,
        )
    except Exception as e:
        log.warning("sonnet_groundtruth_failed", msg_id=msg.id, error=str(e))
        return False

    insert_ground_truth_sample(
        message_id=msg.id,
        sonnet_category=result.category,
        sonnet_bucket=result.bucket,
        sonnet_sentiment=result.sentiment,
        sonnet_urgency=result.urgency,
        sonnet_reasoning=result.reasoning,
        sonnet_model=CONFIG.anthropic.sonnet_model,
        haiku_category=haiku_payload["category"],
        haiku_bucket=haiku_payload["bucket"],
        haiku_sentiment=haiku_payload["sentiment"],
    )
    return True


def run_classification_batch(limit: int | None = None) -> BatchResult:
    """
    Clasifica todos los mensajes unanalyzed. Muestrea N aleatorios para Sonnet ground-truth.
    """
    messages = fetch_unanalyzed_messages(limit=limit)
    if not messages:
        log.info("no_unanalyzed_messages")
        return BatchResult(processed=0, failed=0, ground_truth_sampled=0)

    log.info("batch_start", count=len(messages))

    sample_size = (
        min(CONFIG.analyzer.ground_truth_daily_sample, len(messages))
        if CONFIG.analyzer.feature_ground_truth
        else 0
    )
    sample_ids = set(random.sample([m.id for m in messages], sample_size)) if sample_size > 0 else set()

    processed = 0
    failed = 0
    gt_sampled = 0
    successful_ids: list[int] = []

    for i, msg in enumerate(messages, start=1):
        ok, haiku_payload = _classify_and_persist(msg)
        if ok:
            processed += 1
            successful_ids.append(msg.id)
            if msg.id in sample_ids and haiku_payload is not None:
                if _sample_with_sonnet(msg, haiku_payload):
                    gt_sampled += 1
        else:
            failed += 1

        if i % 25 == 0:
            log.info("batch_progress", done=i, total=len(messages), failed=failed)

    mark_messages_analyzed(successful_ids)
    log.info("batch_done", processed=processed, failed=failed, ground_truth_sampled=gt_sampled)
    return BatchResult(processed=processed, failed=failed, ground_truth_sampled=gt_sampled)
