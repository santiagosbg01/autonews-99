"""Orquestador de clasificación con Sonnet + persistencia."""

from __future__ import annotations

from dataclasses import dataclass

from woi_analyzer.claude_client import classify_message
from woi_analyzer.config import CONFIG
from woi_analyzer.db import (
    MessageRow,
    fetch_context_messages,
    fetch_unanalyzed_messages,
    mark_messages_analyzed,
    upsert_analysis,
)
from woi_analyzer.emoji_sentiment import emoji_sentiment_adjustment
from woi_analyzer.logging_setup import log


@dataclass
class BatchResult:
    processed: int
    failed: int


def _classify_and_persist(msg: MessageRow) -> bool:
    """Clasifica el mensaje con Sonnet y persiste en `analysis`. Devuelve éxito."""
    context = fetch_context_messages(
        group_id=msg.group_id,
        before=msg.timestamp,
        n=CONFIG.analyzer.context_messages,
    )
    content = msg.content or (f"[{msg.media_type}]" if msg.media_type else "[media]")
    try:
        result, raw, usage = classify_message(
            group_name=msg.group_name,
            country=msg.group_country or "MX",
            timezone=msg.group_timezone,
            sender_role=msg.sender_role or "otro",
            sender_phone=msg.sender_phone,
            timestamp=msg.timestamp.isoformat(),
            context_messages=context,
            message_content=content,
            operational_context=msg.group_operational_context,
        )
    except Exception as e:
        log.error("classify_failed", msg_id=msg.id, error=str(e))
        return False

    # Apply emoji/reaction sentiment adjustment as a safety net
    adjustable_content = msg.content or (f"[{msg.media_type}]" if msg.media_type else None)
    adj_sentiment, urgency_override = emoji_sentiment_adjustment(
        content=adjustable_content,
        media_type=msg.media_type,
        claude_sentiment=result.sentiment,
    )
    final_urgency = urgency_override or result.urgency
    if adj_sentiment != result.sentiment or urgency_override:
        log.debug(
            "emoji_adjustment",
            msg_id=msg.id,
            original_sent=result.sentiment,
            adj_sent=adj_sentiment,
            urgency_override=urgency_override,
        )

    upsert_analysis(
        message_id=msg.id,
        category=result.category,
        bucket=result.bucket,
        sentiment=adj_sentiment,
        urgency=final_urgency,
        is_incident_open=result.is_incident_open,
        is_incident_close=result.is_incident_close,
        claude_model=CONFIG.anthropic.sonnet_model,
        claude_usage=usage,
        claude_raw=raw,
        reasoning=result.reasoning,
    )
    return True


def run_classification_batch(limit: int | None = None, group_name: str | None = None) -> BatchResult:
    """
    Clasifica todos los mensajes `analyzed=false` con Sonnet.
    Opcionalmente filtra por nombre de grupo (parcial, case-insensitive).
    """
    messages = fetch_unanalyzed_messages(limit=limit, group_name=group_name)
    if not messages:
        log.info("no_unanalyzed_messages")
        return BatchResult(processed=0, failed=0)

    log.info("batch_start", count=len(messages))

    processed = 0
    failed = 0
    pending_ids: list[int] = []

    for i, msg in enumerate(messages, start=1):
        if _classify_and_persist(msg):
            processed += 1
            pending_ids.append(msg.id)
        else:
            failed += 1

        # Checkpoint every 25 messages so progress is persisted and crash-safe
        if i % 25 == 0:
            mark_messages_analyzed(pending_ids)
            pending_ids = []
            log.info("batch_progress", done=i, total=len(messages), failed=failed)

    if pending_ids:
        mark_messages_analyzed(pending_ids)

    log.info("batch_done", processed=processed, failed=failed)
    return BatchResult(processed=processed, failed=failed)
