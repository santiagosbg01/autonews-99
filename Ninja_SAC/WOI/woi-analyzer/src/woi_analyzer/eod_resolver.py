"""
End-of-Day (EOD) ticket resolution pass.

For each active group, when the local time reaches `EOD_HOUR:xx`, sweeps every
incident that is still open in that group and forces a resolution decision:

- Calls Sonnet (`ask_is_resolved` with `eod_mode=True`) to read the thread and
  decide if the original complaint was effectively addressed.
- Closes the ticket as:
    - `resuelto` with `resolution_source='eod_resolved'` if Sonnet says yes.
    - `no_resuelto_eod` with `resolution_source='eod_unresolved'` if Sonnet
      says no — meaning the day closed without operational resolution.

This guarantees no ticket stays in `abierto`/`respondido`/`pendiente` overnight,
which makes the "resuelto el mismo día" KPI meaningful and gives ops a clean
slate at 00:00 each day.

Idempotency: closed tickets aren't re-evaluated. Within the same scheduler tick
the same ticket can't be closed twice. Across days, only tickets opened during
"today (local)" are considered (plus stragglers older than that, which means
they slipped through previous EOD passes — also worth closing now).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytz

from woi_analyzer.claude_client import ask_is_resolved
from woi_analyzer.db import connect, list_active_groups_with_timezones
from woi_analyzer.logging_setup import log

CDMX_TZ = pytz.timezone("America/Mexico_City")
DEFAULT_EOD_HOUR = 23  # 23:xx local time of each group
MAX_TICKETS_PER_GROUP = 50  # safety cap per group per EOD pass


def _log_status_change(
    cur,
    incident_id: int,
    from_status: str | None,
    to_status: str,
    reason: str,
    source: str,
) -> None:
    """Mirror of the helper in incident_reconstructor.py — kept local to avoid
    a circular import."""
    try:
        cur.execute(
            """
            INSERT INTO ticket_status_logs (
                incident_id, from_status, to_status, reason, source, changed_at
            ) VALUES (%s,%s,%s,%s,%s,NOW())
            """,
            (incident_id, from_status, to_status, reason, source),
        )
    except Exception as e:
        log.warning("eod_status_log_failed", incident_id=incident_id, error=str(e))


def _fetch_open_tickets_for_group(group_id: int) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, opened_at, category, urgency, status, first_response_at
            FROM incidents
            WHERE group_id = %s
              AND closed_at IS NULL
              AND status NOT IN ('resuelto','no_resuelto_eod')
            ORDER BY opened_at ASC
            LIMIT %s
            """,
            (group_id, MAX_TICKETS_PER_GROUP),
        )
        return list(cur.fetchall())


def _fetch_thread(incident_id: int, limit: int = 30) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.sender_role, m.sender_display_name, m.content, m.timestamp, a.category
            FROM analysis a
            JOIN messages m ON m.id = a.message_id
            WHERE a.incident_id = %s AND m.content IS NOT NULL
            ORDER BY m.timestamp DESC
            LIMIT %s
            """,
            (incident_id, limit),
        )
        return list(reversed(cur.fetchall()))


def _close_resolved(cur, incident_id: int, reason: str, prev_status: str | None) -> None:
    cur.execute(
        """
        UPDATE incidents
        SET status            = 'resuelto',
            closed_at         = NOW(),
            resolution_at     = NOW(),
            resolution_source = 'eod_resolved',
            resolution_reason = %s,
            sonnet_checked_at = NOW(),
            updated_at        = NOW()
        WHERE id = %s
        """,
        (reason[:200], incident_id),
    )
    _log_status_change(
        cur, incident_id, prev_status, "resuelto",
        f"EOD: Sonnet confirmó resolución — {reason[:140]}",
        "auto_eod",
    )


def _close_unresolved_eod(
    cur, incident_id: int, reason: str, prev_status: str | None
) -> None:
    fallback = reason or "Cerró el día sin evidencia de resolución de la queja original."
    cur.execute(
        """
        UPDATE incidents
        SET status            = 'no_resuelto_eod',
            closed_at         = NOW(),
            resolution_at     = NOW(),
            resolution_source = 'eod_unresolved',
            resolution_reason = %s,
            sonnet_checked_at = NOW(),
            updated_at        = NOW()
        WHERE id = %s
        """,
        (fallback[:200], incident_id),
    )
    _log_status_change(
        cur, incident_id, prev_status, "no_resuelto_eod",
        f"EOD: sin resolución en el día — {fallback[:140]}",
        "auto_eod",
    )


def run_eod_pass_for_group(group_id: int, group_name: str) -> dict[str, Any]:
    """Force a resolution decision on every open ticket of a single group."""
    open_tickets = _fetch_open_tickets_for_group(group_id)
    if not open_tickets:
        return {
            "group_id": group_id,
            "group": group_name,
            "open_at_eod": 0,
            "resolved": 0,
            "unresolved": 0,
        }

    resolved = 0
    unresolved = 0
    log.info(
        "eod_pass_start",
        group_id=group_id,
        group=group_name,
        open_tickets=len(open_tickets),
    )

    for t in open_tickets:
        incident_id = t["id"]
        prev_status = t.get("status")
        try:
            msgs = _fetch_thread(incident_id)
            if not msgs:
                # No messages linked — close as unresolved with a clear reason.
                with connect() as conn, conn.cursor() as cur:
                    _close_unresolved_eod(
                        cur, incident_id,
                        "Ticket sin mensajes asociados al cierre del día.",
                        prev_status,
                    )
                    conn.commit()
                unresolved += 1
                continue

            verdict = ask_is_resolved(msgs, t.get("category"), eod_mode=True)
            with connect() as conn, conn.cursor() as cur:
                if verdict["resolved"]:
                    _close_resolved(cur, incident_id, verdict["reason"], prev_status)
                    resolved += 1
                else:
                    _close_unresolved_eod(cur, incident_id, verdict["reason"], prev_status)
                    unresolved += 1
                conn.commit()
        except Exception as e:
            log.warning(
                "eod_pass_ticket_failed",
                group_id=group_id, incident_id=incident_id, error=str(e),
            )

    log.info(
        "eod_pass_done",
        group_id=group_id, group=group_name,
        resolved=resolved, unresolved=unresolved,
    )
    return {
        "group_id": group_id,
        "group": group_name,
        "open_at_eod": len(open_tickets),
        "resolved": resolved,
        "unresolved": unresolved,
    }


def run_due_eod_resolution(
    *, eod_hour: int = DEFAULT_EOD_HOUR, force: bool = False
) -> list[dict[str, Any]]:
    """
    For every active group, if the local hour matches `eod_hour`, sweep all
    open tickets and force a resolution decision (resuelto / no_resuelto_eod).

    Designed to be called once per hour by the scheduler. `force=True` ignores
    the hour gate (for ad-hoc runs).
    """
    results: list[dict[str, Any]] = []
    for g in list_active_groups_with_timezones():
        gid = int(g["id"])
        gname = g["name"]
        tz_name = g["timezone"]
        try:
            tz = pytz.timezone(tz_name)
        except Exception:
            log.warning("eod_tz_unknown", group_id=gid, timezone=tz_name)
            tz = CDMX_TZ
            tz_name = "America/Mexico_City"

        now_local = datetime.now(tz)
        if not force and now_local.hour != eod_hour:
            continue

        result = run_eod_pass_for_group(gid, gname)
        results.append({**result, "timezone": tz_name, "local_hour": now_local.strftime("%H:%M")})

    return results
