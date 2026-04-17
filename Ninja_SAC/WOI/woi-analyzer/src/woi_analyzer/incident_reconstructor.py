"""
Incident reconstruction v0 — heurístico simple para V1.

V1 no intenta ser perfecto; solo aprovechar los flags is_incident_open/close que
Haiku ya puso en cada mensaje. Cada 'open' sin close-previo-pendiente abre un
incident, y el siguiente 'close' del mismo owner en ≤72h lo cierra.

Después del T0 spike (semanas 1-2) este módulo se puede reemplazar por un
clustering semántico si el resultado baseline es insuficiente.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from psycopg.rows import dict_row

from woi_analyzer.db import connect
from woi_analyzer.logging_setup import log

INCIDENT_TIMEOUT_HOURS = 72


@dataclass
class IncidentCandidate:
    group_id: int
    opened_at: datetime
    closed_at: datetime | None
    category: str
    urgency: str | None
    owner_phone: str
    message_ids: list[int]
    first_response_at: datetime | None
    first_response_by: str | None
    sentiment_start: float | None
    sentiment_end: float | None
    sentiment_avg: float | None
    timezone: str | None


def _fetch_group_messages_for_reconstruction(group_id: int, since: datetime) -> list[dict[str, Any]]:
    """
    Retorna mensajes + analysis del grupo, ordenados cronológicamente, desde since.
    Solo mensajes que ya están clasificados (analysis.* disponible).
    """
    query = """
        SELECT
            m.id, m.group_id, m.sender_phone, m.sender_role, m.timestamp,
            m.content,
            a.category, a.bucket, a.sentiment, a.urgency,
            a.is_incident_open, a.is_incident_close, a.incident_id,
            g.timezone AS group_tz
        FROM messages m
        JOIN analysis a ON a.message_id = m.id
        JOIN groups g   ON g.id = m.group_id
        WHERE m.group_id = %s
          AND m.timestamp >= %s
        ORDER BY m.timestamp ASC, m.id ASC
    """
    with connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, (group_id, since))
        return cur.fetchall()


def _reconstruct_group(group_id: int, since: datetime) -> list[IncidentCandidate]:
    msgs = _fetch_group_messages_for_reconstruction(group_id, since)
    if not msgs:
        return []

    open_incidents: dict[str, IncidentCandidate] = {}  # owner_phone -> candidate
    finalized: list[IncidentCandidate] = []

    for m in msgs:
        ts: datetime = m["timestamp"]
        owner = m["sender_phone"]
        sentiment = float(m["sentiment"]) if m["sentiment"] is not None else None

        # Cerrar por timeout los abiertos que superen 72h
        stale_owners = [
            o for o, inc in open_incidents.items()
            if ts - inc.opened_at > timedelta(hours=INCIDENT_TIMEOUT_HOURS)
        ]
        for o in stale_owners:
            stale = open_incidents.pop(o)
            finalized.append(stale)

        # Apertura: solo clientes pueden abrir
        if m["is_incident_open"] and m["sender_role"] == "cliente":
            if owner in open_incidents:
                # Cliente abre otra mientras tiene una abierta → cerrar la anterior
                finalized.append(open_incidents.pop(owner))

            open_incidents[owner] = IncidentCandidate(
                group_id=group_id,
                opened_at=ts,
                closed_at=None,
                category=m["category"],
                urgency=m["urgency"],
                owner_phone=owner,
                message_ids=[m["id"]],
                first_response_at=None,
                first_response_by=None,
                sentiment_start=sentiment,
                sentiment_end=sentiment,
                sentiment_avg=sentiment,
                timezone=m["group_tz"],
            )
            continue

        # Para cualquier otro mensaje, si hay incidentes abiertos en el grupo,
        # lo adjuntamos al más reciente (heurística simple V1).
        if open_incidents:
            # Elegimos el incidente más reciente abierto en el grupo (no por owner)
            most_recent_owner = max(open_incidents.keys(), key=lambda o: open_incidents[o].opened_at)
            inc = open_incidents[most_recent_owner]
            inc.message_ids.append(m["id"])

            # First response: primer mensaje de agente_99 después de la apertura
            if (
                inc.first_response_at is None
                and m["sender_role"] == "agente_99"
                and m["category"] in {
                    "acuse_recibo", "confirmacion_resolucion",
                    "problema_unidad", "problema_horario", "problema_entrada",
                    "problema_salida", "problema_trafico", "problema_manifestacion",
                    "robo_incidencia", "problema_sistema", "problema_proveedor",
                }
            ):
                inc.first_response_at = ts
                inc.first_response_by = owner

            # Actualizar sentiment agregado
            if sentiment is not None:
                inc.sentiment_end = sentiment
                prev = inc.sentiment_avg if inc.sentiment_avg is not None else sentiment
                n = len(inc.message_ids)
                inc.sentiment_avg = (prev * (n - 1) + sentiment) / n

            # Cierre: confirmacion_resolucion cierra
            if m["is_incident_close"] and m["category"] == "confirmacion_resolucion":
                inc.closed_at = ts
                finalized.append(open_incidents.pop(most_recent_owner))

    # Los que quedaron abiertos al final del batch se mantienen como open
    finalized.extend(open_incidents.values())
    return finalized


def _upsert_incidents(candidates: list[IncidentCandidate]) -> int:
    """
    Inserta incidentes nuevos o actualiza si ya existe un incident_id asignado a
    alguno de los mensajes del candidato.
    """
    if not candidates:
        return 0

    count = 0
    with connect() as conn, conn.cursor() as cur:
        for c in candidates:
            ttfr = None
            if c.first_response_at:
                ttfr = int((c.first_response_at - c.opened_at).total_seconds())
            ttr = None
            if c.closed_at:
                ttr = int((c.closed_at - c.opened_at).total_seconds())

            # Verificar si ya existe un incident asociado a los mensajes
            cur.execute(
                "SELECT DISTINCT incident_id FROM analysis WHERE message_id = ANY(%s) AND incident_id IS NOT NULL",
                (c.message_ids,),
            )
            existing = [r[0] for r in cur.fetchall() if r[0] is not None]

            if existing:
                incident_id = existing[0]
                cur.execute(
                    """
                    UPDATE incidents SET
                        closed_at = %s,
                        category = COALESCE(%s, category),
                        urgency = COALESCE(%s, urgency),
                        first_response_at = COALESCE(first_response_at, %s),
                        first_response_by = COALESCE(first_response_by, %s),
                        resolution_at = %s,
                        sentiment_end = %s,
                        sentiment_avg = %s,
                        message_count = %s,
                        ttfr_seconds = COALESCE(ttfr_seconds, %s),
                        ttr_seconds = %s
                    WHERE id = %s
                    """,
                    (
                        c.closed_at, c.category, c.urgency,
                        c.first_response_at, c.first_response_by,
                        c.closed_at,
                        c.sentiment_end, c.sentiment_avg,
                        len(c.message_ids), ttfr, ttr, incident_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO incidents (
                        group_id, opened_at, closed_at, category, urgency,
                        first_response_at, first_response_by, resolution_at,
                        sentiment_start, sentiment_end, sentiment_avg,
                        owner_phone, message_count, ttfr_seconds, ttr_seconds, timezone
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING id
                    """,
                    (
                        c.group_id, c.opened_at, c.closed_at, c.category, c.urgency,
                        c.first_response_at, c.first_response_by, c.closed_at,
                        c.sentiment_start, c.sentiment_end, c.sentiment_avg,
                        c.owner_phone, len(c.message_ids), ttfr, ttr, c.timezone,
                    ),
                )
                incident_id = cur.fetchone()[0]

            # Linkear todos los mensajes al incident
            cur.execute(
                "UPDATE analysis SET incident_id = %s WHERE message_id = ANY(%s)",
                (incident_id, c.message_ids),
            )
            count += 1
        conn.commit()
    return count


def reconstruct_recent_incidents(lookback_hours: int = 96) -> int:
    """
    Reconstruye incidentes para todos los grupos activos en la ventana reciente.
    Se corre después del batch de clasificación.
    """
    since = datetime.now().astimezone() - timedelta(hours=lookback_hours)

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM groups WHERE is_active = TRUE")
        group_ids = [r[0] for r in cur.fetchall()]

    total = 0
    for gid in group_ids:
        candidates = _reconstruct_group(gid, since)
        n = _upsert_incidents(candidates)
        total += n
        if n:
            log.info("group_reconstructed", group_id=gid, incidents=n)

    log.info("reconstruction_done", total_incidents=total, groups=len(group_ids))
    return total
