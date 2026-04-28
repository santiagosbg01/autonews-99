"""Queries que alimentan el reporte diario."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row

from woi_reporter.config import CFG


def _connect():
    return psycopg.connect(CFG.db_url, row_factory=dict_row)


def fetch_daily_overview(report_date: date) -> dict[str, Any]:
    """KPIs agregados del día en CDMX."""
    query = """
        WITH day_msgs AS (
            SELECT a.bucket, a.sentiment
            FROM messages m
            JOIN analysis a ON a.message_id = m.id
            JOIN groups g ON g.id = m.group_id
            WHERE (m.timestamp AT TIME ZONE g.timezone)::date = %s
        )
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE bucket='A') AS count_a,
            COUNT(*) FILTER (WHERE bucket='B') AS count_b,
            COUNT(*) FILTER (WHERE bucket='C') AS count_c,
            ROUND(
                COUNT(*) FILTER (WHERE bucket='B')::NUMERIC / NULLIF(COUNT(*),0) * 100, 2
            ) AS ratio_b_pct,
            ROUND(AVG(sentiment)::NUMERIC, 3) AS sentiment_avg
        FROM day_msgs
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(query, (report_date,))
        return cur.fetchone() or {}


def fetch_groups_health(report_date: date) -> list[dict[str, Any]]:
    """Health por grupo del día."""
    query = """
        SELECT
            g.id, g.name, g.pilot_cohort, g.country, g.timezone,
            COUNT(m.id) AS total,
            COUNT(*) FILTER (WHERE a.bucket='A') AS count_a,
            COUNT(*) FILTER (WHERE a.bucket='B') AS count_b,
            COUNT(*) FILTER (WHERE a.bucket='C') AS count_c,
            ROUND(
                COUNT(*) FILTER (WHERE a.bucket='B')::NUMERIC / NULLIF(COUNT(m.id),0) * 100, 2
            ) AS ratio_b_pct,
            ROUND(AVG(a.sentiment)::NUMERIC, 3) AS sentiment_avg
        FROM groups g
        LEFT JOIN messages m
          ON m.group_id = g.id
         AND (m.timestamp AT TIME ZONE g.timezone)::date = %s
        LEFT JOIN analysis a ON a.message_id = m.id
        WHERE g.is_active = TRUE
        GROUP BY g.id, g.name, g.pilot_cohort, g.country, g.timezone
        HAVING COUNT(m.id) > 0
        ORDER BY ratio_b_pct DESC NULLS LAST, total DESC
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(query, (report_date,))
        return cur.fetchall()


def fetch_open_incidents(limit: int = 10) -> list[dict[str, Any]]:
    query = """
        SELECT
            i.id, g.name AS group_name, g.pilot_cohort,
            i.opened_at,
            EXTRACT(EPOCH FROM (NOW() - i.opened_at))/3600 AS open_hours,
            i.category, i.urgency, i.sentiment_avg,
            i.owner_phone, i.summary, i.message_count, i.ttfr_seconds
        FROM incidents i
        JOIN groups g ON g.id = i.group_id
        WHERE i.is_open = TRUE
        ORDER BY
            CASE i.urgency WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
            i.opened_at ASC
        LIMIT %s
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(query, (limit,))
        return cur.fetchall()


def fetch_agents_red_zone(ttfr_threshold_min: int = 30, days: int = 7) -> list[dict[str, Any]]:
    """
    Agentes con TTFR promedio (horario laboral) > ttfr_threshold_min sobre
    tickets CERRADOS en los últimos N días. Filtramos por closed_at para
    alinear población con TTR (ver business_hours.py / fix TTFR-TTR).
    """
    query = """
        SELECT
            i.first_response_by AS agent_phone,
            COALESCE(p.display_name, i.first_response_by) AS agent_name,
            COUNT(*) AS incidents_attended,
            ROUND(AVG(i.ttfr_seconds)::NUMERIC / 60, 2) AS ttfr_avg_min,
            ROUND(AVG(i.ttr_seconds)::NUMERIC / 60, 2) AS ttr_avg_min,
            COUNT(*) AS resolved_count
        FROM incidents i
        LEFT JOIN participants p
          ON p.phone = i.first_response_by
         AND p.group_id = i.group_id
        WHERE i.closed_at >= NOW() - make_interval(days => %s)
          AND i.first_response_by IS NOT NULL
          AND i.ttfr_seconds IS NOT NULL
          AND i.ttr_seconds  IS NOT NULL
        GROUP BY i.first_response_by, p.display_name
        HAVING AVG(i.ttfr_seconds)/60 > %s
        ORDER BY ttfr_avg_min DESC
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(query, (days, ttfr_threshold_min))
        return cur.fetchall()


def fetch_agent_leaderboard(days: int = 7) -> list[dict[str, Any]]:
    """
    Leaderboard de agentes (últimos N días):
    - incidents_attended: tickets en los que este agente fue first_response_by.
    - resolved_count + resolution_rate_pct: cuántos de esos cerraron.
    - ttfr_avg_min / ttr_avg_min: promedios SOLO sobre tickets cerrados (poblacion
      alineada para que TTR ≥ TTFR siempre). Valores en SEGUNDOS DE HORARIO LABORAL.
    """
    query = """
        SELECT
            i.first_response_by AS agent_phone,
            COALESCE(p.display_name, i.first_response_by) AS agent_name,
            COUNT(*) AS incidents_attended,
            ROUND(AVG(i.ttfr_seconds) FILTER (
                WHERE i.closed_at IS NOT NULL
                  AND i.ttfr_seconds IS NOT NULL
                  AND i.ttr_seconds  IS NOT NULL
            )::NUMERIC / 60, 2) AS ttfr_avg_min,
            ROUND(AVG(i.ttr_seconds) FILTER (
                WHERE i.closed_at IS NOT NULL
                  AND i.ttfr_seconds IS NOT NULL
                  AND i.ttr_seconds  IS NOT NULL
            )::NUMERIC / 60, 2) AS ttr_avg_min,
            COUNT(*) FILTER (WHERE i.closed_at IS NOT NULL) AS resolved_count,
            ROUND(
                COUNT(*) FILTER (WHERE i.closed_at IS NOT NULL)::NUMERIC
                / NULLIF(COUNT(*), 0) * 100, 2
            ) AS resolution_rate_pct
        FROM incidents i
        LEFT JOIN participants p
          ON p.phone = i.first_response_by
         AND p.group_id = i.group_id
        WHERE i.opened_at >= NOW() - make_interval(days => %s)
          AND i.first_response_by IS NOT NULL
        GROUP BY i.first_response_by, p.display_name
        ORDER BY ttfr_avg_min ASC NULLS LAST
        LIMIT 30
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(query, (days,))
        return cur.fetchall()


def fetch_raw_sample(report_date: date, limit: int = 20) -> list[dict[str, Any]]:
    """Muestra aleatoria de 20 mensajes clasificados del día para spot-check."""
    query = """
        SELECT
            m.id, g.name AS group_name, m.timestamp,
            m.sender_role, m.sender_display_name, m.content,
            a.category, a.bucket, a.sentiment, a.urgency,
            a.is_incident_open, a.is_incident_close, a.reasoning,
            a.claude_model
        FROM messages m
        JOIN analysis a ON a.message_id = m.id
        JOIN groups g   ON g.id = m.group_id
        WHERE (m.timestamp AT TIME ZONE g.timezone)::date = %s
          AND m.content IS NOT NULL
        ORDER BY random()
        LIMIT %s
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(query, (report_date, limit))
        return cur.fetchall()


def upsert_daily_report_log(
    report_date: date,
    overview: dict,
    incidents: list[dict],
    agents_red: list[dict],
    groups_at_risk: list[dict],
    narrative: str,
    sheet_url: str,
) -> None:
    query = """
        INSERT INTO daily_reports (
            report_date, total_messages, bucket_a_count, bucket_b_count, bucket_c_count,
            ratio_b, incidents_opened, incidents_closed,
            top_incidents_json, agents_red_zone_json, groups_at_risk_json,
            sonnet_narrative, sheet_url, slack_delivered
        ) VALUES (
            %(date)s, %(total)s, %(a)s, %(b)s, %(c)s,
            %(ratio)s, %(opened)s, %(closed)s,
            %(incidents)s::jsonb, %(agents)s::jsonb, %(groups)s::jsonb,
            %(narrative)s, %(sheet_url)s, TRUE
        )
        ON CONFLICT (report_date) DO UPDATE SET
            total_messages = EXCLUDED.total_messages,
            bucket_a_count = EXCLUDED.bucket_a_count,
            bucket_b_count = EXCLUDED.bucket_b_count,
            bucket_c_count = EXCLUDED.bucket_c_count,
            ratio_b = EXCLUDED.ratio_b,
            top_incidents_json = EXCLUDED.top_incidents_json,
            agents_red_zone_json = EXCLUDED.agents_red_zone_json,
            groups_at_risk_json = EXCLUDED.groups_at_risk_json,
            sonnet_narrative = EXCLUDED.sonnet_narrative,
            sheet_url = EXCLUDED.sheet_url,
            generated_at = NOW()
    """
    import json
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            query,
            {
                "date": report_date,
                "total": overview.get("total", 0),
                "a": overview.get("count_a", 0),
                "b": overview.get("count_b", 0),
                "c": overview.get("count_c", 0),
                "ratio": overview.get("ratio_b_pct"),
                "opened": sum(1 for i in incidents if i.get("open_hours", 0) < 24),
                "closed": 0,
                "incidents": json.dumps(incidents, default=str),
                "agents": json.dumps(agents_red, default=str),
                "groups": json.dumps(groups_at_risk, default=str),
                "narrative": narrative,
                "sheet_url": sheet_url,
            },
        )
        conn.commit()
