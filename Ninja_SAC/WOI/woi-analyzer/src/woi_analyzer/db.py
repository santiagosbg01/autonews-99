"""Acceso a Postgres (Supabase) con psycopg3."""

from __future__ import annotations

import json
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
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
    group_country: str | None
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
    group_name: str | None = None,
) -> list[MessageRow]:
    """
    Devuelve mensajes con analyzed=false. Incluye denormalizado group_name, group_timezone
    y group_country para usar en prompts y cálculos de TZ.
    Incluye mensajes sin content (solo media) para que el clasificador use un stub.
    Opcionalmente filtra por nombre de grupo (ILIKE para búsqueda parcial).
    """
    query = """
        SELECT
            m.id, m.whatsapp_msg_id, m.group_id,
            g.name     AS group_name,
            g.timezone AS group_timezone,
            g.country  AS group_country,
            m.sender_phone, m.sender_role, m.sender_display_name,
            m.timestamp, m.content, m.media_type, m.reply_to_msg_id
        FROM messages m
        JOIN groups g ON g.id = m.group_id
        WHERE m.analyzed = FALSE
          AND g.is_active = TRUE
          AND (m.content IS NOT NULL OR m.media_type IS NOT NULL)
    """
    params: list[Any] = []
    if group_name is not None:
        query += " AND g.name ILIKE %s"
        params.append(f"%{group_name}%")
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


def fetch_incident_messages(message_ids: list[int]) -> list[dict[str, Any]]:
    """Retorna contenido de mensajes para generar un resumen de incidente."""
    if not message_ids:
        return []
    query = """
        SELECT m.id, m.sender_role, m.sender_display_name, m.timestamp, m.content, m.media_type,
               a.category, a.bucket, a.sentiment, a.urgency
        FROM messages m
        LEFT JOIN analysis a ON a.message_id = m.id
        WHERE m.id = ANY(%s)
        ORDER BY m.timestamp ASC
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, (message_ids,))
        return cur.fetchall()


def update_incident_summary(incident_id: int, summary: str) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE incidents SET summary = %s WHERE id = %s",
            (summary, incident_id),
        )
        conn.commit()


def fetch_daily_report_input(report_date: datetime) -> dict[str, Any]:
    """
    Agrega datos del día para el brief ejecutivo de Sonnet.
    report_date: fecha local (CDMX) del reporte.
    """
    import pytz
    cdmx = pytz.timezone("America/Mexico_City")
    cdmx_dt = report_date.astimezone(cdmx)
    day_start = cdmx.localize(cdmx_dt.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None))
    day_end   = cdmx.localize(cdmx_dt.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=None))

    with connect() as conn, conn.cursor() as cur:
        # Totales del día por bucket
        cur.execute(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a.bucket = 'A') AS bucket_a,
                COUNT(*) FILTER (WHERE a.bucket = 'B') AS bucket_b,
                COUNT(*) FILTER (WHERE a.bucket = 'C') AS bucket_c,
                ROUND(AVG(a.sentiment)::NUMERIC, 3) AS avg_sentiment
            FROM messages m
            JOIN analysis a ON a.message_id = m.id
            WHERE m.timestamp BETWEEN %s AND %s
            """,
            (day_start, day_end),
        )
        totals = cur.fetchone() or {}

        # Incidentes abiertos/cerrados hoy.
        # IMPORTANTE: avg_ttfr y avg_ttr se calculan sobre la MISMA población —
        # tickets cerrados en la ventana — para que el promedio de TTR siempre
        # sea ≥ promedio de TTFR (por ticket TTR≥TTFR siempre, y al alinear el
        # subset evitamos selection bias). Ambos valores están en SEGUNDOS DE
        # HORARIO LABORAL (ver business_hours.py).
        cur.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE opened_at BETWEEN %s AND %s) AS opened_today,
                COUNT(*) FILTER (WHERE closed_at BETWEEN %s AND %s) AS closed_today,
                ROUND(AVG(ttfr_seconds)::NUMERIC / 60, 1) FILTER (
                    WHERE closed_at BETWEEN %s AND %s AND ttfr_seconds IS NOT NULL
                ) AS avg_ttfr_min,
                ROUND(AVG(ttr_seconds)::NUMERIC / 60, 1) FILTER (
                    WHERE closed_at BETWEEN %s AND %s AND ttr_seconds IS NOT NULL
                ) AS avg_ttr_min
            FROM incidents
            """,
            (day_start, day_end, day_start, day_end, day_start, day_end, day_start, day_end),
        )
        inc_stats = cur.fetchone() or {}

        # Top incidentes abiertos (criticidad)
        cur.execute(
            """
            SELECT i.id, g.name AS group_name, i.category, i.urgency,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - i.opened_at)) / 3600, 1) AS open_hours,
                   i.sentiment_avg, i.message_count, i.ttfr_seconds
            FROM incidents i
            JOIN groups g ON g.id = i.group_id
            WHERE i.is_open = TRUE
            ORDER BY CASE i.urgency WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                     i.opened_at ASC
            LIMIT 10
            """,
        )
        open_incidents = cur.fetchall()

        # Agentes en zona roja (TTFR business-hours > 30min hoy).
        # Solo cuenta tickets ya cerrados para población consistente.
        cur.execute(
            """
            SELECT i.first_response_by AS agent_phone,
                   COALESCE(p.display_name, i.first_response_by) AS agent_name,
                   COUNT(*) AS incidents_attended,
                   ROUND(AVG(i.ttfr_seconds)::NUMERIC / 60, 1) AS avg_ttfr_min
            FROM incidents i
            LEFT JOIN participants p ON p.phone = i.first_response_by AND p.group_id = i.group_id
            WHERE i.closed_at BETWEEN %s AND %s
              AND i.first_response_by IS NOT NULL
              AND i.ttfr_seconds IS NOT NULL
            GROUP BY i.first_response_by, p.display_name
            HAVING AVG(i.ttfr_seconds) > 1800
            ORDER BY avg_ttfr_min DESC
            """,
            (day_start, day_end),
        )
        agents_red_zone = cur.fetchall()

        # Grupos con ratio B > 25% hoy
        cur.execute(
            """
            SELECT g.name AS group_name,
                   COUNT(*) FILTER (WHERE a.bucket = 'B') AS count_b,
                   COUNT(*) AS total,
                   ROUND(COUNT(*) FILTER (WHERE a.bucket = 'B')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) AS ratio_b_pct,
                   ROUND(AVG(a.sentiment)::NUMERIC, 3) AS sentiment_avg
            FROM messages m
            JOIN groups g ON g.id = m.group_id
            JOIN analysis a ON a.message_id = m.id
            WHERE m.timestamp BETWEEN %s AND %s
            GROUP BY g.name
            HAVING COUNT(*) FILTER (WHERE a.bucket = 'B')::NUMERIC / NULLIF(COUNT(*), 0) > 0.25
            ORDER BY ratio_b_pct DESC
            """,
            (day_start, day_end),
        )
        groups_at_risk = cur.fetchall()

    return {
        "date": report_date.strftime("%Y-%m-%d"),
        "totals": dict(totals),
        "incident_stats": dict(inc_stats),
        "open_incidents": [dict(r) for r in open_incidents],
        "agents_red_zone": [dict(r) for r in agents_red_zone],
        "groups_at_risk": [dict(r) for r in groups_at_risk],
    }


def insert_daily_report(
    report_date: datetime,
    data: dict[str, Any],
    narrative: str,
) -> None:
    totals = data.get("totals", {})
    inc = data.get("incident_stats", {})
    total = totals.get("total") or 0
    bucket_b = totals.get("bucket_b") or 0
    ratio_b = round(bucket_b / total, 4) if total > 0 else None

    # NOTA: la columna `haiku_consistency_pct` se mantiene en el schema por
    # compatibilidad con históricos, pero ya no se actualiza (todo el pipeline
    # corre con Sonnet). Ver migration 015.
    query = """
        INSERT INTO daily_reports (
            report_date, total_messages,
            bucket_a_count, bucket_b_count, bucket_c_count, ratio_b,
            incidents_opened, incidents_closed,
            avg_ttfr_seconds, avg_ttr_seconds,
            top_incidents_json, agents_red_zone_json, groups_at_risk_json,
            sonnet_narrative
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (report_date) DO UPDATE SET
            total_messages       = EXCLUDED.total_messages,
            bucket_a_count       = EXCLUDED.bucket_a_count,
            bucket_b_count       = EXCLUDED.bucket_b_count,
            bucket_c_count       = EXCLUDED.bucket_c_count,
            ratio_b              = EXCLUDED.ratio_b,
            incidents_opened     = EXCLUDED.incidents_opened,
            incidents_closed     = EXCLUDED.incidents_closed,
            avg_ttfr_seconds     = EXCLUDED.avg_ttfr_seconds,
            avg_ttr_seconds      = EXCLUDED.avg_ttr_seconds,
            top_incidents_json   = EXCLUDED.top_incidents_json,
            agents_red_zone_json = EXCLUDED.agents_red_zone_json,
            groups_at_risk_json  = EXCLUDED.groups_at_risk_json,
            sonnet_narrative     = EXCLUDED.sonnet_narrative,
            generated_at         = NOW()
    """

    def _to_minutes(seconds: Any) -> int | None:
        if seconds is None:
            return None
        try:
            return int(float(str(seconds)) * 60)
        except (ValueError, TypeError):
            return None

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            query,
            (
                report_date.date(),
                total,
                totals.get("bucket_a") or 0,
                bucket_b,
                totals.get("bucket_c") or 0,
                ratio_b,
                inc.get("opened_today") or 0,
                inc.get("closed_today") or 0,
                _to_minutes(inc.get("avg_ttfr_min")),
                _to_minutes(inc.get("avg_ttr_min")),
                json.dumps([r for r in data.get("open_incidents", [])], default=str),
                json.dumps([r for r in data.get("agents_red_zone", [])], default=str),
                json.dumps([r for r in data.get("groups_at_risk", [])], default=str),
                narrative,
            ),
        )
        conn.commit()


def upsert_group_kpi_snapshot(
    group_id: int,
    snapshot_date: datetime,
    client_sentiment_avg: float | None,
    overall_sentiment_avg: float | None,
    total_messages: int,
    bucket_a: int,
    bucket_b: int,
    bucket_c: int,
    incidents_opened: int,
    incidents_closed: int,
    avg_ttfr_seconds: int | None,
    avg_ttr_seconds: int | None,
    p90_ttfr_seconds: int | None,
    risk_level: str | None,
    anomaly_count: int,
) -> None:
    ratio_b = round(bucket_b / total_messages, 4) if total_messages > 0 else None
    query = """
        INSERT INTO group_kpi_snapshots (
            group_id, snapshot_date,
            client_sentiment_avg, overall_sentiment_avg,
            total_messages, bucket_a, bucket_b, bucket_c, ratio_b,
            incidents_opened, incidents_closed,
            avg_ttfr_seconds, avg_ttr_seconds, p90_ttfr_seconds,
            risk_level, anomaly_count
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (group_id, snapshot_date) DO UPDATE SET
            client_sentiment_avg  = EXCLUDED.client_sentiment_avg,
            overall_sentiment_avg = EXCLUDED.overall_sentiment_avg,
            total_messages        = EXCLUDED.total_messages,
            bucket_a              = EXCLUDED.bucket_a,
            bucket_b              = EXCLUDED.bucket_b,
            bucket_c              = EXCLUDED.bucket_c,
            ratio_b               = EXCLUDED.ratio_b,
            incidents_opened      = EXCLUDED.incidents_opened,
            incidents_closed      = EXCLUDED.incidents_closed,
            avg_ttfr_seconds      = EXCLUDED.avg_ttfr_seconds,
            avg_ttr_seconds       = EXCLUDED.avg_ttr_seconds,
            p90_ttfr_seconds      = EXCLUDED.p90_ttfr_seconds,
            risk_level            = EXCLUDED.risk_level,
            anomaly_count         = EXCLUDED.anomaly_count
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, (
            group_id, snapshot_date.date(),
            client_sentiment_avg, overall_sentiment_avg,
            total_messages, bucket_a, bucket_b, bucket_c, ratio_b,
            incidents_opened, incidents_closed,
            avg_ttfr_seconds, avg_ttr_seconds, p90_ttfr_seconds,
            risk_level, anomaly_count,
        ))
        conn.commit()


def compute_group_kpis_for_date(group_id: int, day: datetime) -> dict[str, Any]:
    """Computes aggregated KPIs for a group on a given day (local calendar date)."""
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end   = day.replace(hour=23, minute=59, second=59, microsecond=999999)

    with connect() as conn, conn.cursor() as cur:
        # Message + sentiment stats
        cur.execute("""
            SELECT
                COUNT(*)                                                    AS total,
                COUNT(*) FILTER (WHERE a.bucket = 'A')                     AS bucket_a,
                COUNT(*) FILTER (WHERE a.bucket = 'B')                     AS bucket_b,
                COUNT(*) FILTER (WHERE a.bucket = 'C')                     AS bucket_c,
                ROUND(AVG(a.sentiment)::NUMERIC, 3)                        AS overall_sentiment,
                ROUND(AVG(a.sentiment) FILTER (
                    WHERE m.sender_role = 'cliente' AND a.sentiment IS NOT NULL
                )::NUMERIC, 3)                                              AS client_sentiment
            FROM messages m
            LEFT JOIN analysis a ON a.message_id = m.id
            WHERE m.group_id = %s AND m.timestamp BETWEEN %s AND %s
        """, (group_id, day_start, day_end))
        msg = cur.fetchone() or {}

        # Incident stats + TTFR percentiles.
        # avg_ttfr, avg_ttr y p90_ttfr se computan sobre la misma población
        # (tickets cerrados en la ventana) para evitar selection bias entre
        # tickets que cerraron rápido vs los que aún están abiertos. Los
        # valores son SEGUNDOS DE HORARIO LABORAL (ver business_hours.py).
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE opened_at BETWEEN %s AND %s)        AS opened,
                COUNT(*) FILTER (WHERE closed_at BETWEEN %s AND %s)        AS closed,
                ROUND(AVG(ttfr_seconds) FILTER (
                    WHERE closed_at BETWEEN %s AND %s AND ttfr_seconds IS NOT NULL
                ))::INT                                                     AS avg_ttfr,
                ROUND(AVG(ttr_seconds) FILTER (
                    WHERE closed_at BETWEEN %s AND %s AND ttr_seconds IS NOT NULL
                ))::INT                                                     AS avg_ttr,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ttfr_seconds)
                    FILTER (WHERE closed_at BETWEEN %s AND %s AND ttfr_seconds IS NOT NULL)::INT
                                                                            AS p90_ttfr
            FROM incidents
            WHERE group_id = %s
        """, (
            day_start, day_end,
            day_start, day_end,
            day_start, day_end,
            day_start, day_end,
            day_start, day_end,
            group_id,
        ))
        inc = cur.fetchone() or {}

    return {
        "total_messages":        msg.get("total") or 0,
        "bucket_a":              msg.get("bucket_a") or 0,
        "bucket_b":              msg.get("bucket_b") or 0,
        "bucket_c":              msg.get("bucket_c") or 0,
        "overall_sentiment_avg": float(msg["overall_sentiment"]) if msg.get("overall_sentiment") is not None else None,
        "client_sentiment_avg":  float(msg["client_sentiment"]) if msg.get("client_sentiment") is not None else None,
        "incidents_opened":      inc.get("opened") or 0,
        "incidents_closed":      inc.get("closed") or 0,
        "avg_ttfr_seconds":      inc.get("avg_ttfr"),
        "avg_ttr_seconds":       inc.get("avg_ttr"),
        "p90_ttfr_seconds":      inc.get("p90_ttfr"),
    }


def fetch_group_kpi_history(group_id: int, days: int = 30) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT snapshot_date, client_sentiment_avg, overall_sentiment_avg,
                   total_messages, bucket_a, bucket_b, bucket_c, ratio_b,
                   incidents_opened, incidents_closed,
                   avg_ttfr_seconds, avg_ttr_seconds, p90_ttfr_seconds,
                   risk_level, anomaly_count
            FROM group_kpi_snapshots
            WHERE group_id = %s
              AND snapshot_date >= CURRENT_DATE - INTERVAL '%s days'
            ORDER BY snapshot_date ASC
        """, (group_id, days))
        return cur.fetchall()


def fetch_active_groups() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, timezone, country, vertical FROM groups WHERE is_active = TRUE ORDER BY name"
        )
        return cur.fetchall()


def fetch_messages_for_group_analysis(
    group_id: int,
    since: datetime,
    until: datetime,
) -> list[dict[str, Any]]:
    """Retorna mensajes + análisis del grupo en la ventana dada para la análisis de grupo."""
    query = """
        SELECT
            m.id, m.sender_phone, m.sender_role, m.sender_display_name,
            m.timestamp, m.content, m.media_type,
            a.category, a.bucket, a.sentiment, a.urgency, a.reasoning
        FROM messages m
        LEFT JOIN analysis a ON a.message_id = m.id
        WHERE m.group_id = %s
          AND m.timestamp BETWEEN %s AND %s
        ORDER BY m.timestamp ASC
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, (group_id, since, until))
        return cur.fetchall()


def insert_group_analysis(
    group_id: int,
    window_start: datetime,
    window_end: datetime,
    message_count: int,
    narrative: str,
    insights: dict[str, Any],
    participants_summary: list[dict[str, Any]],
    category_counts: dict[str, int],
    claude_model: str,
    input_tokens: int,
    output_tokens: int,
) -> int:
    query = """
        INSERT INTO group_analyses (
            group_id, window_start, window_end, message_count,
            narrative, insights, participants_summary, category_counts,
            claude_model, input_tokens, output_tokens
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            query,
            (
                group_id, window_start, window_end, message_count,
                narrative,
                json.dumps(insights, ensure_ascii=False),
                json.dumps(participants_summary, ensure_ascii=False),
                json.dumps(category_counts, ensure_ascii=False),
                claude_model, input_tokens, output_tokens,
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return row["id"] if row else -1


def fetch_latest_group_analysis(group_id: int) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, analyzed_at, window_start, window_end, message_count,
                   narrative, insights, participants_summary, category_counts
            FROM group_analyses
            WHERE group_id = %s
            ORDER BY analyzed_at DESC
            LIMIT 1
            """,
            (group_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def reset_analyzed_flag(
    group_name: str | None = None,
    since: datetime | None = None,
) -> int:
    """
    Marca mensajes como analyzed=FALSE para que el clasificador los re-procese.
    Retorna el número de filas afectadas.
    """
    query = """
        UPDATE messages m
        SET analyzed = FALSE
        FROM groups g
        WHERE m.group_id = g.id
          AND g.is_active = TRUE
    """
    params: list[Any] = []
    if group_name is not None:
        query += " AND g.name ILIKE %s"
        params.append(f"%{group_name}%")
    if since is not None:
        query += " AND m.timestamp >= %s"
        params.append(since)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        count = cur.rowcount
        conn.commit()
    return count


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


# ---------------------------------------------------------------------------
# Media analysis
# ---------------------------------------------------------------------------

def fetch_unanalyzed_media(limit: int = 50) -> list[dict[str, Any]]:
    """Mensajes con media_url que aún no tienen análisis visual."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.id, m.group_id, g.name AS group_name,
                   m.media_url, m.media_type, m.content, m.timestamp
            FROM messages m
            JOIN groups g ON g.id = m.group_id
            WHERE m.media_url IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM media_analysis ma WHERE ma.message_id = m.id
              )
            ORDER BY m.timestamp DESC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


# ---------------------------------------------------------------------------
# Morning briefing — data gathering + persistence
# ---------------------------------------------------------------------------

def fetch_morning_briefing_input(
    briefing_date: datetime,
    group_id: int | None = None,
    timezone_name: str | None = None,
) -> dict[str, Any]:
    """
    Reúne todo el contexto necesario para que Sonnet genere el morning briefing.
    `briefing_date` es la fecha local que el briefing va a CUBRIR (típicamente ayer).
    `group_id` filtra todas las queries a un solo grupo (si es None, briefing global legacy).
    `timezone_name` se usa para calcular el día local del grupo (si None, defaults a CDMX).
    """
    import pytz
    tz = pytz.timezone(timezone_name or "America/Mexico_City")
    base_local = briefing_date.astimezone(tz) if briefing_date.tzinfo else tz.localize(briefing_date)
    day_start = tz.localize(base_local.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None))
    day_end = tz.localize(base_local.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=None))

    week_start = day_start - timedelta(days=7)
    month_start = day_start - timedelta(days=30)

    # Per-group filter snippet (applied wherever needed)
    group_filter_msg = " AND m.group_id = %s" if group_id else ""
    group_filter_inc = " AND i.group_id = %s" if group_id else ""
    group_filter_inc_unprefixed = " AND group_id = %s" if group_id else ""

    def _maybe_g(*existing: Any) -> tuple:
        """Append group_id to params tuple if filtering by group."""
        return (*existing, group_id) if group_id else existing

    with connect() as conn, conn.cursor() as cur:
        # ── Yesterday metrics ──────────────────────────────────────────────
        cur.execute(
            f"""
            SELECT
                COUNT(*)                                            AS total_messages,
                ROUND(AVG(a.sentiment)::NUMERIC, 3)                 AS avg_sentiment
            FROM messages m
            LEFT JOIN analysis a ON a.message_id = m.id
            WHERE m.timestamp BETWEEN %s AND %s
              {group_filter_msg}
            """,
            _maybe_g(day_start, day_end),
        )
        msg_stats = cur.fetchone() or {}

        # avg_ttfr_seconds del briefing matutino: filtramos por closed_at
        # para alinear población con TTR en otros queries (ver
        # business_hours.py / fix de TTFR-TTR del 2026-04-27).
        cur.execute(
            f"""
            SELECT
                COUNT(*)                                                            AS total_incidents,
                COUNT(*) FILTER (WHERE closed_at BETWEEN %s AND %s)                 AS incidents_resolved,
                COUNT(*) FILTER (WHERE escalated_at BETWEEN %s AND %s)              AS incidents_escalated,
                ROUND(AVG(ttfr_seconds) FILTER (
                    WHERE closed_at BETWEEN %s AND %s AND ttfr_seconds IS NOT NULL
                ))::INT                                                              AS avg_ttfr_seconds
            FROM incidents
            WHERE (opened_at BETWEEN %s AND %s OR closed_at BETWEEN %s AND %s)
              {group_filter_inc_unprefixed}
            """,
            _maybe_g(day_start, day_end, day_start, day_end, day_start, day_end,
                     day_start, day_end, day_start, day_end),
        )
        inc_stats = cur.fetchone() or {}

        # ── Incidents grouped by category yesterday ───────────────────────
        cur.execute(
            f"""
            SELECT category, COUNT(*) AS count
            FROM incidents
            WHERE opened_at BETWEEN %s AND %s
              AND category IS NOT NULL
              {group_filter_inc_unprefixed}
            GROUP BY category
            ORDER BY count DESC
            """,
            _maybe_g(day_start, day_end),
        )
        incidents_by_category = cur.fetchall()

        # ── Top open incidents (still open at briefing time) ──────────────
        cur.execute(
            f"""
            SELECT i.id, g.name AS group_name, i.category, i.urgency,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - i.opened_at)) / 3600, 1) AS open_hours,
                   COALESCE(i.summary, '') AS summary
            FROM incidents i
            JOIN groups g ON g.id = i.group_id
            WHERE i.is_open = TRUE
              {group_filter_inc}
            ORDER BY CASE i.urgency WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                     i.opened_at ASC
            LIMIT 10
            """,
            _maybe_g(),
        )
        top_open_incidents = cur.fetchall()

        # ── Groups to watch (ratio B > 25% yesterday) ─────────────────────
        # Skip when filtering by group: doesn't make sense per-group
        if group_id is None:
            cur.execute(
                """
                SELECT g.name AS group_name,
                       COUNT(*) FILTER (WHERE a.bucket = 'B') AS count_b,
                       ROUND(COUNT(*) FILTER (WHERE a.bucket = 'B')::NUMERIC
                             / NULLIF(COUNT(*), 0) * 100, 1)  AS ratio_b_pct,
                       ROUND(AVG(a.sentiment)::NUMERIC, 3)    AS sentiment_avg
                FROM messages m
                JOIN groups g ON g.id = m.group_id
                JOIN analysis a ON a.message_id = m.id
                WHERE m.timestamp BETWEEN %s AND %s
                GROUP BY g.name
                HAVING COUNT(*) FILTER (WHERE a.bucket = 'B')::NUMERIC
                       / NULLIF(COUNT(*), 0) > 0.25
                ORDER BY ratio_b_pct DESC
                LIMIT 10
                """,
                (day_start, day_end),
            )
            groups_to_watch = cur.fetchall()
        else:
            groups_to_watch = []

        # ── Recurring problems (same group + category, multiple times) ────
        cur.execute(
            f"""
            WITH yesterday AS (
                SELECT g.name AS group_name, i.category, COUNT(*) AS cnt
                FROM incidents i
                JOIN groups g ON g.id = i.group_id
                WHERE i.opened_at BETWEEN %s AND %s
                  AND i.category IS NOT NULL
                  {group_filter_inc}
                GROUP BY g.name, i.category
            ),
            week AS (
                SELECT g.name AS group_name, i.category, COUNT(*) AS cnt
                FROM incidents i
                JOIN groups g ON g.id = i.group_id
                WHERE i.opened_at BETWEEN %s AND %s
                  AND i.category IS NOT NULL
                  {group_filter_inc}
                GROUP BY g.name, i.category
            ),
            month AS (
                SELECT g.name AS group_name, i.category, COUNT(*) AS cnt
                FROM incidents i
                JOIN groups g ON g.id = i.group_id
                WHERE i.opened_at BETWEEN %s AND %s
                  AND i.category IS NOT NULL
                  {group_filter_inc}
                GROUP BY g.name, i.category
            )
            SELECT y.group_name, y.category,
                   y.cnt          AS count_yesterday,
                   COALESCE(w.cnt, 0) AS count_7d,
                   COALESCE(mo.cnt, 0) AS count_30d
            FROM yesterday y
            LEFT JOIN week  w  ON w.group_name = y.group_name AND w.category = y.category
            LEFT JOIN month mo ON mo.group_name = y.group_name AND mo.category = y.category
            ORDER BY count_30d DESC, count_yesterday DESC
            LIMIT 15
            """,
            (
                day_start, day_end, *((group_id,) if group_id else ()),
                week_start, day_end, *((group_id,) if group_id else ()),
                month_start, day_end, *((group_id,) if group_id else ()),
            ),
        )
        recurring_problems = cur.fetchall()

        # ── Agents in red zone yesterday ──────────────────────────────────
        # TTFR business-hours > 30min sobre tickets cerrados ayer.
        cur.execute(
            f"""
            SELECT i.first_response_by AS agent_phone,
                   COALESCE(p.display_name, i.first_response_by) AS agent_name,
                   COUNT(*) AS incidents_attended,
                   ROUND(AVG(i.ttfr_seconds)::NUMERIC / 60, 1) AS avg_ttfr_min
            FROM incidents i
            LEFT JOIN participants p
                   ON p.phone = i.first_response_by AND p.group_id = i.group_id
            WHERE i.closed_at BETWEEN %s AND %s
              AND i.first_response_by IS NOT NULL
              AND i.ttfr_seconds IS NOT NULL
              {group_filter_inc}
            GROUP BY i.first_response_by, p.display_name
            HAVING AVG(i.ttfr_seconds) > 1800
            ORDER BY avg_ttfr_min DESC
            LIMIT 6
            """,
            _maybe_g(day_start, day_end),
        )
        agents_red_zone = cur.fetchall()

        # ── Weekly + monthly context ──────────────────────────────────────
        cur.execute(
            f"""
            SELECT
                COUNT(*) FILTER (WHERE opened_at BETWEEN %s AND %s
                                 {group_filter_inc_unprefixed.replace('AND group_id', 'AND incidents.group_id') if group_id else ''})  AS incidents_7d,
                COUNT(*) FILTER (WHERE opened_at BETWEEN %s AND %s
                                 {group_filter_inc_unprefixed.replace('AND group_id', 'AND incidents.group_id') if group_id else ''})  AS incidents_30d,
                ROUND(AVG(ttfr_seconds) FILTER (
                    WHERE opened_at BETWEEN %s AND %s AND ttfr_seconds IS NOT NULL
                    {group_filter_inc_unprefixed.replace('AND group_id', 'AND incidents.group_id') if group_id else ''}
                ))::INT / 60                                            AS ttfr_7d_min
            FROM incidents
            """,
            (
                week_start, day_end, *((group_id,) if group_id else ()),
                month_start, day_end, *((group_id,) if group_id else ()),
                week_start, day_end, *((group_id,) if group_id else ()),
            ),
        )
        ctx_inc = cur.fetchone() or {}

        cur.execute(
            f"""
            SELECT
                ROUND(AVG(a.sentiment) FILTER (WHERE m.timestamp BETWEEN %s AND %s)::NUMERIC, 3) AS avg_sentiment_7d,
                ROUND(AVG(a.sentiment) FILTER (WHERE m.timestamp BETWEEN %s AND %s)::NUMERIC, 3) AS avg_sentiment_30d
            FROM messages m
            JOIN analysis a ON a.message_id = m.id
            WHERE 1=1 {group_filter_msg}
            """,
            (
                week_start, day_end,
                month_start, day_end,
                *((group_id,) if group_id else ()),
            ),
        )
        ctx_sent = cur.fetchone() or {}

        # ── Churn signals: client messages with very negative sentiment ───
        cur.execute(
            f"""
            SELECT g.name AS group_name,
                   m.content AS quote,
                   m.sender_role,
                   m.sender_display_name,
                   m.timestamp,
                   a.sentiment,
                   a.urgency,
                   a.category
            FROM messages m
            JOIN groups g ON g.id = m.group_id
            JOIN analysis a ON a.message_id = m.id
            WHERE m.timestamp BETWEEN %s AND %s
              AND m.content IS NOT NULL
              AND LENGTH(m.content) BETWEEN 15 AND 600
              AND m.sender_role IN ('cliente', 'otro')
              AND (a.sentiment <= -0.5 OR a.urgency = 'alta')
              {group_filter_msg}
            ORDER BY a.sentiment ASC NULLS LAST
            LIMIT 25
            """,
            _maybe_g(day_start, day_end),
        )
        churn_candidates = cur.fetchall()

        # ── Group context (when filtering by group) ───────────────────────
        group_ctx: dict[str, Any] = {}
        if group_id is not None:
            cur.execute(
                "SELECT id, name, country, timezone FROM groups WHERE id = %s",
                (group_id,),
            )
            g_row = cur.fetchone()
            if g_row:
                group_ctx = dict(g_row)

    return {
        "date": briefing_date.strftime("%Y-%m-%d"),
        "scope": "group" if group_id else "global",
        "group": group_ctx if group_ctx else None,
        "yesterday_metrics": {
            "total_messages":      msg_stats.get("total_messages") or 0,
            "total_incidents":     inc_stats.get("total_incidents") or 0,
            "incidents_resolved":  inc_stats.get("incidents_resolved") or 0,
            "incidents_escalated": inc_stats.get("incidents_escalated") or 0,
            "avg_ttfr_seconds":    inc_stats.get("avg_ttfr_seconds"),
            "avg_sentiment":       float(msg_stats["avg_sentiment"]) if msg_stats.get("avg_sentiment") is not None else None,
        },
        "incidents_by_category": [dict(r) for r in incidents_by_category],
        "top_open_incidents":    [dict(r) for r in top_open_incidents],
        "groups_to_watch":       [dict(r) for r in groups_to_watch],
        "recurring_problems":    [dict(r) for r in recurring_problems],
        "agents_red_zone":       [dict(r) for r in agents_red_zone],
        "weekly_context": {
            "incidents_7d":      ctx_inc.get("incidents_7d") or 0,
            "incidents_30d":     ctx_inc.get("incidents_30d") or 0,
            "ttfr_7d_min":       ctx_inc.get("ttfr_7d_min"),
            "avg_sentiment_7d":  float(ctx_sent["avg_sentiment_7d"])  if ctx_sent.get("avg_sentiment_7d")  is not None else None,
            "avg_sentiment_30d": float(ctx_sent["avg_sentiment_30d"]) if ctx_sent.get("avg_sentiment_30d") is not None else None,
        },
        "churn_candidates": [dict(r) for r in churn_candidates],
    }


def briefing_exists(briefing_date, group_id: int | None) -> bool:
    """Return True if a briefing for (date, group_id) already exists."""
    bd = briefing_date.date() if isinstance(briefing_date, datetime) else briefing_date
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM morning_briefings
            WHERE briefing_date = %s
              AND COALESCE(group_id, 0) = COALESCE(%s, 0)
            LIMIT 1
            """,
            (bd, group_id),
        )
        return cur.fetchone() is not None


def insert_morning_briefing(
    *,
    briefing_date: datetime,
    metrics: dict[str, Any],
    headline: str,
    briefing_json: dict[str, Any],
    briefing_markdown: str,
    claude_model: str,
    input_tokens: int,
    output_tokens: int,
    group_id: int | None = None,
    timezone_name: str | None = None,
) -> int:
    """Insert/upsert a briefing for (briefing_date, group_id)."""
    bd = briefing_date.date() if isinstance(briefing_date, datetime) else briefing_date

    with connect() as conn, conn.cursor() as cur:
        # We can't use ON CONFLICT with the partial-coalesce index, so do
        # an explicit "delete-and-insert" inside a tx.
        cur.execute(
            """
            DELETE FROM morning_briefings
            WHERE briefing_date = %s
              AND COALESCE(group_id, 0) = COALESCE(%s, 0)
            """,
            (bd, group_id),
        )
        cur.execute(
            """
            INSERT INTO morning_briefings (
                briefing_date, group_id, timezone,
                total_messages, total_incidents, incidents_resolved, incidents_escalated,
                avg_ttfr_seconds, avg_sentiment,
                headline, briefing_json, briefing_markdown,
                claude_model, input_tokens, output_tokens
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (
                bd,
                group_id,
                timezone_name,
                metrics.get("total_messages") or 0,
                metrics.get("total_incidents") or 0,
                metrics.get("incidents_resolved") or 0,
                metrics.get("incidents_escalated") or 0,
                metrics.get("avg_ttfr_seconds"),
                metrics.get("avg_sentiment"),
                headline,
                json.dumps(briefing_json, ensure_ascii=False, default=str),
                briefing_markdown,
                claude_model,
                input_tokens,
                output_tokens,
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return row["id"] if row else -1


def list_active_groups_with_timezones() -> list[dict[str, Any]]:
    """Return active groups with id, name, country, timezone (normalized)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, country,
                   COALESCE(timezone,
                            CASE country
                              WHEN 'MX' THEN 'America/Mexico_City'
                              WHEN 'PE' THEN 'America/Lima'
                              WHEN 'CL' THEN 'America/Santiago'
                              WHEN 'CO' THEN 'America/Bogota'
                              WHEN 'AR' THEN 'America/Argentina/Buenos_Aires'
                              WHEN 'BR' THEN 'America/Sao_Paulo'
                              ELSE 'America/Mexico_City'
                            END
                   ) AS timezone
            FROM groups
            WHERE is_active = TRUE
            ORDER BY country, name
            """
        )
        return [dict(r) for r in cur.fetchall()]


def insert_churn_signal(
    *,
    group_id: int,
    message_id: int | None,
    severity: str,
    source: str,
    quote: str,
    matched_keyword: str | None,
    confidence: float | None,
    context: str | None,
    sender_phone: str | None,
    sender_display_name: str | None,
    sender_role: str | None,
    incident_id: int | None = None,
) -> int:
    """
    Insert a churn-risk signal. Idempotent thanks to the
    `(COALESCE(message_id,0), severity, source)` unique index — duplicates
    return the existing row id (-1 if conflict and no row returned).
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO churn_signals (
                group_id, message_id, incident_id,
                severity, confidence, source,
                quote, context, matched_keyword,
                sender_phone, sender_display_name, sender_role
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (COALESCE(message_id, 0), severity, source, md5(LEFT(quote, 240))) DO NOTHING
            RETURNING id
            """,
            (
                group_id, message_id, incident_id,
                severity, confidence, source,
                quote, context, matched_keyword,
                sender_phone, sender_display_name, sender_role,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return row["id"] if row else -1


def list_open_churn_signals(
    *, group_id: int | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    """List unresolved churn signals, newest first."""
    sql = """
        SELECT cs.id, cs.group_id, g.name AS group_name, g.country AS group_country,
               cs.message_id, cs.incident_id,
               cs.detected_at, cs.severity, cs.confidence, cs.source,
               cs.quote, cs.context, cs.matched_keyword,
               cs.sender_phone, cs.sender_display_name, cs.sender_role,
               cs.resolved_at, cs.resolved_by, cs.resolution_note,
               m.timestamp AS message_timestamp
        FROM churn_signals cs
        LEFT JOIN groups   g ON g.id = cs.group_id
        LEFT JOIN messages m ON m.id = cs.message_id
        WHERE cs.resolved_at IS NULL
    """
    args: list[Any] = []
    if group_id is not None:
        sql += " AND cs.group_id = %s"
        args.append(group_id)
    sql += " ORDER BY cs.detected_at DESC LIMIT %s"
    args.append(limit)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, args)
        return [dict(r) for r in cur.fetchall()]


def resolve_churn_signal(
    *, signal_id: int, resolved_by: str = "manual", note: str | None = None
) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE churn_signals
               SET resolved_at = NOW(),
                   resolved_by = %s,
                   resolution_note = %s
             WHERE id = %s AND resolved_at IS NULL
            RETURNING id
            """,
            (resolved_by, note, signal_id),
        )
        row = cur.fetchone()
        conn.commit()
        return row is not None


def insert_media_analysis(
    *,
    message_id: int,
    group_id: int,
    media_url: str,
    media_category: str,
    description: str,
    extracted_text: str | None,
    confidence: float,
    claude_model: str,
) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO media_analysis (
                message_id, group_id, media_url,
                media_category, description, extracted_text, confidence, claude_model
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (message_id) DO UPDATE SET
                media_category = EXCLUDED.media_category,
                description    = EXCLUDED.description,
                extracted_text = EXCLUDED.extracted_text,
                confidence     = EXCLUDED.confidence,
                analyzed_at    = NOW()
            """,
            (message_id, group_id, media_url, media_category,
             description, extracted_text, confidence, claude_model),
        )
        conn.commit()
