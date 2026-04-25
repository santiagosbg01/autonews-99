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

from datetime import timezone as _tz

from woi_analyzer.claude_client import generate_incident_summary, ask_is_resolved
from woi_analyzer.db import connect, fetch_incident_messages, update_incident_summary
from woi_analyzer.logging_setup import log
from woi_analyzer.slack import alert_incident_opened

INCIDENT_TIMEOUT_HOURS = 72

# SLA thresholds for auto-escalation
ESCALATE_ALTA_MIN  = 45    # auto-escalate alta urgency if no ACK in 45 min
ESCALATE_MEDIA_MIN = 120   # auto-escalate media urgency if no ACK in 2 hours
PENDING_HOURS      = 4     # responded but still open after 4h → pendiente

# Inactivity-based resolution: if no new messages after this many hours → resuelto
INACTIVITY_RESOLVE_HOURS = 4

# STRONG close: clear resolution signal from ANY sender (unit left, delivery confirmed, etc.)
STRONG_CLOSE_CATEGORIES = {
    "confirmacion_resolucion",   # explicit "ya se resolvió"
    "confirmacion_salida",       # unit left — incident over regardless of who says it
    "confirmacion_evidencias",   # evidence submitted — delivery complete
}

# WEAK close: partial signals — only close when sent by an agent (avoid false positives)
WEAK_CLOSE_CATEGORIES = {
    "reporte_entrega",           # delivery reported (agent confirmation preferred)
    "confirmacion_llegada",      # unit arrived — could mean start, not end
}


def _derive_status(
    closed_at: datetime | None,
    first_response_at: datetime | None,
    urgency: str | None,
    opened_at: datetime,
    now: datetime,
) -> tuple[str, str | None]:
    """
    Calcula (status, escalated_reason) para un incident candidate.
    Status: abierto | respondido | resuelto | escalado | pendiente
    """
    if closed_at is not None:
        return "resuelto", None

    open_minutes = (now - opened_at).total_seconds() / 60

    if first_response_at is None:
        # Sin respuesta
        if urgency == "alta" and open_minutes >= ESCALATE_ALTA_MIN:
            return "escalado", "sin_respuesta_alta_urgencia"
        if urgency == "media" and open_minutes >= ESCALATE_MEDIA_MIN:
            return "escalado", "sin_respuesta_media_urgencia"
        return "abierto", None

    # Con respuesta pero aún abierto
    open_hours = open_minutes / 60
    if open_hours >= PENDING_HOURS:
        return "pendiente", None
    return "respondido", None


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
    # Why/how this incident was closed (used only when closed_at is set).
    # 'agent_signal' = strong/weak close from agente_99, 'customer_signal' = strong
    # close from a non-agent (cliente confirmed delivery, etc.). None when still open.
    resolution_source: str | None = None
    resolution_reason: str | None = None


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

        # Apertura: cualquier no-agente puede abrir (cliente o 'otro' no mapeado)
        if m["is_incident_open"] and m["sender_role"] != "agente_99":
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

            # Cierre: tres caminos posibles
            # 1. Claude ya clasificó como is_incident_close=True → cerrar de cualquier sender
            # 2. Categoría FUERTE (salida confirmada, resolución explícita) → cualquier sender
            # 3. Categoría DÉBIL (reporte entrega, llegada) → solo agente_99
            is_strong_close = (
                m["is_incident_close"]
                or m["category"] in STRONG_CLOSE_CATEGORIES
            )
            is_weak_close = (
                not is_strong_close
                and m["category"] in WEAK_CLOSE_CATEGORIES
                and m["sender_role"] == "agente_99"
            )
            if is_strong_close or is_weak_close:
                inc.closed_at = ts
                # Track origin so the dashboard can audit and the EOD pass can
                # tell apart explicit closes from inferred ones.
                if m["sender_role"] == "agente_99":
                    inc.resolution_source = "agent_signal"
                    inc.resolution_reason = (
                        f"Agente cerró el ticket con categoría '{m['category']}'."
                    )
                else:
                    inc.resolution_source = "customer_signal"
                    inc.resolution_reason = (
                        f"{m['sender_role'] or 'cliente'} confirmó cierre con categoría '{m['category']}'."
                    )
                finalized.append(open_incidents.pop(most_recent_owner))

    # Los que quedaron abiertos al final del batch se mantienen como open
    finalized.extend(open_incidents.values())
    return finalized


def _upsert_incidents(candidates: list[IncidentCandidate]) -> int:
    """
    Inserta incidentes nuevos o actualiza si ya existe un incident_id asignado a
    alguno de los mensajes del candidato.
    Genera summaries Sonnet para incidentes cerrados y envía alertas Slack.
    """
    if not candidates:
        return 0

    count = 0
    # Track (candidate, incident_id, is_new) for post-commit processing
    finalized: list[tuple[IncidentCandidate, int, bool]] = []

    now = datetime.now().astimezone()

    with connect() as conn, conn.cursor() as cur:
        for c in candidates:
            ttfr = None
            if c.first_response_at:
                ttfr = int((c.first_response_at - c.opened_at).total_seconds())
            ttr = None
            if c.closed_at:
                ttr = int((c.closed_at - c.opened_at).total_seconds())

            status, escalated_reason = _derive_status(
                closed_at=c.closed_at,
                first_response_at=c.first_response_at,
                urgency=c.urgency,
                opened_at=c.opened_at,
                now=now,
            )
            escalated_at = now if status == "escalado" else None

            # Verificar si ya existe un incident asociado a los mensajes
            cur.execute(
                "SELECT DISTINCT incident_id FROM analysis WHERE message_id = ANY(%s) AND incident_id IS NOT NULL",
                (c.message_ids,),
            )
            existing = [r["incident_id"] for r in cur.fetchall() if r["incident_id"] is not None]

            is_new = False
            if existing:
                incident_id = existing[0]
                cur.execute(
                    """
                    UPDATE incidents SET
                        closed_at         = %s,
                        category          = COALESCE(%s, category),
                        urgency           = COALESCE(%s, urgency),
                        first_response_at = COALESCE(first_response_at, %s),
                        first_response_by = COALESCE(first_response_by, %s),
                        resolution_at     = %s,
                        resolution_source = COALESCE(resolution_source, %s),
                        resolution_reason = COALESCE(resolution_reason, %s),
                        sentiment_end     = %s,
                        sentiment_avg     = %s,
                        message_count     = %s,
                        ttfr_seconds      = COALESCE(ttfr_seconds, %s),
                        ttr_seconds       = %s,
                        status            = %s,
                        escalated_at      = COALESCE(escalated_at, %s),
                        escalated_reason  = COALESCE(escalated_reason, %s),
                        updated_at        = NOW()
                    WHERE id = %s
                    """,
                    (
                        c.closed_at, c.category, c.urgency,
                        c.first_response_at, c.first_response_by,
                        c.closed_at,
                        c.resolution_source, c.resolution_reason,
                        c.sentiment_end, c.sentiment_avg,
                        len(c.message_ids), ttfr, ttr,
                        status, escalated_at, escalated_reason,
                        incident_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO incidents (
                        group_id, opened_at, closed_at, category, urgency,
                        first_response_at, first_response_by, resolution_at,
                        resolution_source, resolution_reason,
                        sentiment_start, sentiment_end, sentiment_avg,
                        owner_phone, message_count, ttfr_seconds, ttr_seconds, timezone,
                        status, escalated_at, escalated_reason
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING id
                    """,
                    (
                        c.group_id, c.opened_at, c.closed_at, c.category, c.urgency,
                        c.first_response_at, c.first_response_by, c.closed_at,
                        c.resolution_source, c.resolution_reason,
                        c.sentiment_start, c.sentiment_end, c.sentiment_avg,
                        c.owner_phone, len(c.message_ids), ttfr, ttr, c.timezone,
                        status, escalated_at, escalated_reason,
                    ),
                )
                incident_id = cur.fetchone()["id"]
                is_new = True

            # Linkear todos los mensajes al incident
            cur.execute(
                "UPDATE analysis SET incident_id = %s WHERE message_id = ANY(%s)",
                (incident_id, c.message_ids),
            )
            count += 1
            finalized.append((c, incident_id, is_new))

        conn.commit()

    # Post-commit: Slack alerts + Sonnet summaries (outside the transaction)
    for c, incident_id, is_new in finalized:
        # Slack alert for new alta/media incidents
        if is_new and c.urgency in ("alta", "media"):
            try:
                with connect() as conn2, conn2.cursor() as cur2:
                    cur2.execute("SELECT name FROM groups WHERE id = %s", (c.group_id,))
                    row = cur2.fetchone()
                    group_name = row["name"] if row else f"grupo#{c.group_id}"
                alert_incident_opened(
                    group_name=group_name,
                    category=c.category or "desconocida",
                    urgency=c.urgency or "baja",
                    owner_phone=c.owner_phone or "???",
                    incident_id=incident_id,
                )
            except Exception as e:
                log.warning("slack_alert_failed", incident_id=incident_id, error=str(e))

        # Sonnet summary for closed/timed-out incidents
        if c.closed_at is not None or len(c.message_ids) >= 3:
            try:
                msgs = fetch_incident_messages(c.message_ids)
                if msgs:
                    ttfr_sec = int((c.first_response_at - c.opened_at).total_seconds()) if c.first_response_at else None
                    ttr_sec = int((c.closed_at - c.opened_at).total_seconds()) if c.closed_at else None
                    summary = generate_incident_summary(
                        messages=msgs,
                        category=c.category,
                        urgency=c.urgency,
                        ttfr_seconds=ttfr_sec,
                        ttr_seconds=ttr_sec,
                        is_closed=c.closed_at is not None,
                    )
                    update_incident_summary(incident_id, summary)
                    log.info("incident_summary_generated", incident_id=incident_id)
            except Exception as e:
                log.warning("incident_summary_failed", incident_id=incident_id, error=str(e))

    return count


def _log_status_change(cur, incident_id: int, from_status: str, to_status: str, reason: str | None, source: str) -> None:
    """Escribe entrada en ticket_status_logs."""
    cur.execute(
        """
        INSERT INTO ticket_status_logs (incident_id, changed_by, from_status, to_status, reason, source)
        VALUES (%s, 'system', %s, %s, %s, %s)
        """,
        (incident_id, from_status, to_status, reason, source),
    )


# How long a ticket must be open before Sonnet starts evaluating it.
# Lower = faster detection of quick resolutions, more API spend.
SONNET_MIN_OPEN_MINUTES = 30
# Cooldown between Sonnet checks of the same ticket (avoids burning tokens).
SONNET_COOLDOWN_HOURS = 1
# Max tickets evaluated per scheduler tick (rate-limit).
SONNET_BATCH_SIZE = 30


def refresh_open_ticket_statuses() -> int:
    """
    Recorre todos los tickets abiertos/respondidos y:
    1. Recalcula SLA (escalado, pendiente) basado en tiempos.
    2. Detecta resolución por inactividad: sin mensajes nuevos en INACTIVITY_RESOLVE_HOURS.
    3. Para tickets abiertos ≥SONNET_MIN_OPEN_MINUTES, pregunta a Sonnet si el hilo
       indica resolución implícita (la queja original ya fue atendida).
    Escribe en ticket_status_logs cada cambio con source='auto'.
    """
    now = datetime.now().astimezone()
    inactivity_cutoff = now - timedelta(hours=INACTIVITY_RESOLVE_HOURS)

    with connect() as conn, conn.cursor() as cur:
        # Fetch open/in-progress tickets + last message timestamp
        cur.execute(
            """
            SELECT
                i.id, i.opened_at, i.first_response_at, i.closed_at,
                i.urgency, i.status, i.escalated_at,
                MAX(m.timestamp) AS last_msg_at
            FROM incidents i
            LEFT JOIN analysis a ON a.incident_id = i.id
            LEFT JOIN messages m ON m.id = a.message_id
            WHERE i.closed_at IS NULL
            GROUP BY i.id
            ORDER BY i.opened_at DESC
            """
        )
        rows = cur.fetchall()
        updated = 0

        for row in rows:
            old_status   = row["status"] or "abierto"
            last_msg_at  = row["last_msg_at"]
            incident_id  = row["id"]

            # ── 1. Inactivity resolution ─────────────────────────────────────
            # If there was an agent response AND no messages for INACTIVITY_RESOLVE_HOURS
            if (
                row["first_response_at"] is not None
                and last_msg_at is not None
                and last_msg_at < inactivity_cutoff
                and old_status not in ("resuelto", "escalado")
            ):
                reason = f"Sin actividad por {INACTIVITY_RESOLVE_HOURS}h tras respuesta del agente."
                cur.execute(
                    """
                    UPDATE incidents
                    SET status            = 'resuelto',
                        closed_at         = %s,
                        resolution_at     = %s,
                        resolution_source = COALESCE(resolution_source, 'inactivity'),
                        resolution_reason = COALESCE(resolution_reason, %s),
                        updated_at        = NOW()
                    WHERE id = %s
                    """,
                    (last_msg_at, last_msg_at, reason, incident_id),
                )
                _log_status_change(cur, incident_id, old_status, "resuelto", reason, "auto")
                updated += 1
                log.info("ticket_resolved_inactivity", incident_id=incident_id,
                         last_msg_at=str(last_msg_at))
                continue

            # ── 2. SLA-based status transitions ──────────────────────────────
            new_status, esc_reason = _derive_status(
                closed_at=row["closed_at"],
                first_response_at=row["first_response_at"],
                urgency=row["urgency"],
                opened_at=row["opened_at"],
                now=now,
            )
            if new_status != old_status:
                esc_at = now if new_status == "escalado" and row["escalated_at"] is None else row["escalated_at"]
                cur.execute(
                    """
                    UPDATE incidents
                    SET status = %s, escalated_at = COALESCE(escalated_at, %s),
                        escalated_reason = COALESCE(escalated_reason, %s), updated_at = NOW()
                    WHERE id = %s
                    """,
                    (new_status, esc_at, esc_reason, incident_id),
                )
                _log_status_change(cur, incident_id, old_status, new_status, esc_reason, "auto")
                updated += 1

        conn.commit()

    # ── 3. Sonnet resolution pass for tickets open ≥SONNET_MIN_OPEN_MINUTES ──
    sonnet_cutoff = now - timedelta(minutes=SONNET_MIN_OPEN_MINUTES)
    sonnet_resolved = _sonnet_resolution_pass(now, sonnet_cutoff)
    updated += sonnet_resolved

    if updated:
        log.info("ticket_statuses_refreshed", updated=updated)
    return updated


def _sonnet_resolution_pass(now: datetime, cutoff: datetime) -> int:
    """
    Para cualquier ticket abierto hace ≥SONNET_MIN_OPEN_MINUTES, pregunta a Sonnet
    si el hilo indica resolución implícita. Procesa máx. SONNET_BATCH_SIZE tickets
    por ronda y respeta cooldown de SONNET_COOLDOWN_HOURS entre checks del mismo
    ticket. Persiste el `reason` devuelto por Sonnet en `resolution_reason`.
    """
    updated = 0
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT i.id, i.opened_at, i.category, i.urgency, i.status
            FROM incidents i
            WHERE i.status NOT IN ('resuelto', 'escalado', 'no_resuelto_eod')
              AND i.closed_at IS NULL
              AND i.opened_at < %s
              AND (i.sonnet_checked_at IS NULL
                   OR i.sonnet_checked_at < NOW() - INTERVAL '{SONNET_COOLDOWN_HOURS} hours')
            ORDER BY i.opened_at ASC
            LIMIT {SONNET_BATCH_SIZE}
            """,
            (cutoff,),
        )
        tickets = cur.fetchall()

    for ticket in tickets:
        incident_id = ticket["id"]
        try:
            with connect() as conn2, conn2.cursor() as cur2:
                cur2.execute(
                    """
                    SELECT m.sender_role, m.sender_display_name, m.content, m.timestamp, a.category
                    FROM analysis a
                    JOIN messages m ON m.id = a.message_id
                    WHERE a.incident_id = %s AND m.content IS NOT NULL
                    ORDER BY m.timestamp DESC
                    LIMIT 25
                    """,
                    (incident_id,),
                )
                msgs = list(reversed(cur2.fetchall()))

            if not msgs:
                continue

            verdict = ask_is_resolved(msgs, ticket["category"])

            with connect() as conn3, conn3.cursor() as cur3:
                cur3.execute(
                    "UPDATE incidents SET sonnet_checked_at = NOW() WHERE id = %s",
                    (incident_id,),
                )
                # Only act on confident verdicts. Low confidence stays open and
                # gets a fresh check after cooldown.
                if verdict["resolved"] and verdict["confidence"] in ("alta", "media"):
                    cur3.execute(
                        """
                        UPDATE incidents
                        SET status            = 'resuelto',
                            closed_at         = NOW(),
                            resolution_at     = NOW(),
                            resolution_source = 'sonnet_thread',
                            resolution_reason = %s,
                            updated_at        = NOW()
                        WHERE id = %s
                        """,
                        (verdict["reason"], incident_id),
                    )
                    _log_status_change(
                        cur3, incident_id, ticket.get("status", "pendiente"),
                        "resuelto",
                        f"Sonnet ({verdict['confidence']}): {verdict['reason'][:140]}",
                        "auto",
                    )
                    updated += 1
                    log.info("ticket_resolved_sonnet",
                             incident_id=incident_id,
                             confidence=verdict["confidence"],
                             reason=verdict["reason"][:80])
                conn3.commit()

        except Exception as e:
            log.warning("sonnet_resolution_check_failed", incident_id=incident_id, error=str(e))

    return updated


def reconstruct_recent_incidents(lookback_hours: int = 96) -> int:
    """
    Reconstruye incidentes para todos los grupos activos en la ventana reciente.
    Se corre después del batch de clasificación.
    """
    since = datetime.now().astimezone() - timedelta(hours=lookback_hours)

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM groups WHERE is_active = TRUE")
        group_ids = [r["id"] for r in cur.fetchall()]

    total = 0
    for gid in group_ids:
        candidates = _reconstruct_group(gid, since)
        n = _upsert_incidents(candidates)
        total += n
        if n:
            log.info("group_reconstructed", group_id=gid, incidents=n)

    log.info("reconstruction_done", total_incidents=total, groups=len(group_ids))
    return total
