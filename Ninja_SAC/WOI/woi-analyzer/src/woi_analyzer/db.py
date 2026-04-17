"""Acceso a Postgres (Supabase) con psycopg3."""

from __future__ import annotations

import json
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from woi_analyzer.config import CONFIG
from woi_analyzer.logging_setup import log


@contextmanager
def connect():
    conn = psycopg.connect(CONFIG.supabase.db_url, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


@dataclass
class MessageRow:
    id: int
    whatsapp_msg_id: str
    group_id: int
    group_name: str
    group_timezone: str
    sender_phone: str
    sender_role: str | None
    sender_display_name: str | None
    timestamp: datetime
    content: str | None
    media_type: str | None
    reply_to_msg_id: str | None


def fetch_unanalyzed_messages(
    since: datetime | None = None,
    limit: int | None = None,
) -> list[MessageRow]:
    """
    Devuelve mensajes con analyzed=false. Incluye denormalizado group_name y group_timezone
    para usar en prompts y cálculos de TZ.
    """
    query = """
        SELECT
            m.id, m.whatsapp_msg_id, m.group_id,
            g.name     AS group_name,
            g.timezone AS group_timezone,
            m.sender_phone, m.sender_role, m.sender_display_name,
            m.timestamp, m.content, m.media_type, m.reply_to_msg_id
        FROM messages m
        JOIN groups g ON g.id = m.group_id
        WHERE m.analyzed = FALSE
          AND g.is_active = TRUE
          AND m.content IS NOT NULL
    """
    params: list[Any] = []
    if since is not None:
        query += " AND m.timestamp >= %s"
        params.append(since)
    query += " ORDER BY m.group_id ASC, m.timestamp ASC"
    if limit is not None:
        query += " LIMIT %s"
        params.append(limit)

    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    return [MessageRow(**r) for r in rows]


def fetch_context_messages(group_id: int, before: datetime, n: int = 3) -> list[dict[str, Any]]:
    """Obtiene los N mensajes previos en el grupo antes del timestamp dado."""
    query = """
        SELECT id, sender_phone, sender_role, sender_display_name, timestamp, content, media_type
        FROM messages
        WHERE group_id = %s
          AND timestamp < %s
          AND content IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT %s
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, (group_id, before, n))
        rows = cur.fetchall()
    return list(reversed(rows))  # cronológico ascendente


def upsert_analysis(
    message_id: int,
    category: str,
    bucket: str,
    sentiment: float | None,
    urgency: str | None,
    is_incident_open: bool,
    is_incident_close: bool,
    claude_model: str,
    claude_usage: dict[str, Any] | None,
    claude_raw: dict[str, Any],
    reasoning: str | None,
) -> None:
    query = """
        INSERT INTO analysis (
            message_id, category, bucket, sentiment, urgency,
            is_incident_open, is_incident_close,
            claude_model,
            claude_input_tokens, claude_output_tokens,
            claude_cache_read_tokens, claude_cache_creation_tokens,
            claude_raw, reasoning
        ) VALUES (
            %(message_id)s, %(category)s, %(bucket)s, %(sentiment)s, %(urgency)s,
            %(is_incident_open)s, %(is_incident_close)s,
            %(claude_model)s,
            %(input_tokens)s, %(output_tokens)s,
            %(cache_read_tokens)s, %(cache_creation_tokens)s,
            %(claude_raw)s, %(reasoning)s
        )
        ON CONFLICT (message_id) DO UPDATE SET
            category = EXCLUDED.category,
            bucket = EXCLUDED.bucket,
            sentiment = EXCLUDED.sentiment,
            urgency = EXCLUDED.urgency,
            is_incident_open = EXCLUDED.is_incident_open,
            is_incident_close = EXCLUDED.is_incident_close,
            claude_model = EXCLUDED.claude_model,
            claude_input_tokens = EXCLUDED.claude_input_tokens,
            claude_output_tokens = EXCLUDED.claude_output_tokens,
            claude_cache_read_tokens = EXCLUDED.claude_cache_read_tokens,
            claude_cache_creation_tokens = EXCLUDED.claude_cache_creation_tokens,
            claude_raw = EXCLUDED.claude_raw,
            reasoning = EXCLUDED.reasoning,
            analyzed_at = NOW()
    """
    usage = claude_usage or {}
    params = {
        "message_id": message_id,
        "category": category,
        "bucket": bucket,
        "sentiment": sentiment,
        "urgency": urgency,
        "is_incident_open": is_incident_open,
        "is_incident_close": is_incident_close,
        "claude_model": claude_model,
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "cache_read_tokens": usage.get("cache_read_input_tokens"),
        "cache_creation_tokens": usage.get("cache_creation_input_tokens"),
        "claude_raw": json.dumps(claude_raw),
        "reasoning": reasoning,
    }
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        conn.commit()


def mark_messages_analyzed(message_ids: list[int]) -> None:
    if not message_ids:
        return
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE messages SET analyzed = TRUE WHERE id = ANY(%s)",
            (message_ids,),
        )
        conn.commit()


def insert_ground_truth_sample(
    message_id: int,
    sonnet_category: str,
    sonnet_bucket: str,
    sonnet_sentiment: float | None,
    sonnet_urgency: str | None,
    sonnet_reasoning: str | None,
    sonnet_model: str,
    haiku_category: str | None,
    haiku_bucket: str | None,
    haiku_sentiment: float | None,
) -> None:
    query = """
        INSERT INTO ground_truth_samples (
            message_id, sonnet_category, sonnet_bucket, sonnet_sentiment,
            sonnet_urgency, sonnet_reasoning, sonnet_model,
            haiku_category, haiku_bucket, haiku_sentiment
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (message_id) DO UPDATE SET
            sonnet_category = EXCLUDED.sonnet_category,
            sonnet_bucket = EXCLUDED.sonnet_bucket,
            sonnet_sentiment = EXCLUDED.sonnet_sentiment,
            sonnet_urgency = EXCLUDED.sonnet_urgency,
            sonnet_reasoning = EXCLUDED.sonnet_reasoning,
            sonnet_model = EXCLUDED.sonnet_model,
            haiku_category = EXCLUDED.haiku_category,
            haiku_bucket = EXCLUDED.haiku_bucket,
            haiku_sentiment = EXCLUDED.haiku_sentiment
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            query,
            (
                message_id, sonnet_category, sonnet_bucket, sonnet_sentiment,
                sonnet_urgency, sonnet_reasoning, sonnet_model,
                haiku_category, haiku_bucket, haiku_sentiment,
            ),
        )
        conn.commit()


def compute_haiku_consistency(days: int = 1) -> float | None:
    """Devuelve % de match_category de las muestras ground_truth de los últimos N días."""
    query = """
        SELECT
            COUNT(*) FILTER (WHERE match_category)::FLOAT
            / NULLIF(COUNT(*), 0) * 100 AS pct
        FROM ground_truth_samples
        WHERE created_at >= NOW() - make_interval(days => %s)
          AND haiku_category IS NOT NULL
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, (days,))
        row = cur.fetchone()
    return row["pct"] if row and row["pct"] is not None else None


def fetch_taxonomy() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT category, bucket, bucket_label, description_es, sort_order
            FROM taxonomy
            WHERE is_active = TRUE
            ORDER BY sort_order
            """
        )
        return cur.fetchall()
