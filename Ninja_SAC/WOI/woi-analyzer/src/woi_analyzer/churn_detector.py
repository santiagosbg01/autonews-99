"""
Churn-risk detector.

Two complementary signal sources:

1. **Keyword scan** (this module): cheap, deterministic, runs every hour
   immediately after classification. Flags Spanish phrases that almost
   always indicate the client is unhappy enough to consider leaving:
       - explicit threats to leave / cancel / change provider
       - aggressive / abusive language toward agents
       - explicit dissatisfaction phrases ("pésimo servicio", etc.)

2. **Sonnet morning briefing** (in `morning_briefing.py`): nuanced,
   context-aware, runs once per day per group. Reads the briefing JSON
   `churn_signals[]` and persists each one into the same table.

Both write into `churn_signals` with a `source` column so we can tell them
apart, and the `(message_id, severity, source)` unique index makes
re-running idempotent.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from woi_analyzer.db import (
    connect,
    insert_churn_signal,
)
from woi_analyzer.logging_setup import log


# ─── Keyword patterns ────────────────────────────────────────────────────────
# Each pattern is matched case-insensitively against `messages.content`.
# Order matters: more severe patterns first; we only emit the highest-severity
# match per message per scan.

THREAT_TO_LEAVE: list[tuple[str, str]] = [
    # phrase                                                              # canonical keyword shown in UI
    (r"\b(?:vamos|voy|ire|iré|nos vamos)\s+(?:a\s+)?(?:cancelar|terminar|cerrar|romper)\b", "amenaza cancelación"),
    (r"\bya no (?:queremos|quiero|vamos a)\s+(?:trabajar|seguir|continuar)\b",              "amenaza salida"),
    (r"\b(?:cancelar?|cancelaci[oó]n)\s+(?:el\s+)?(?:contrato|servicio|cuenta)\b",           "cancelación servicio"),
    (r"\b(?:cambiar|cambiamos|nos cambiaremos|migr(?:ar|amos))\s+(?:de\s+)?(?:proveedor|servicio|empresa|paquetería|paqueteria)\b", "amenaza cambio proveedor"),
    (r"\b(?:buscar|buscamos|considerar(?:emos|amos)?|evaluar(?:emos|amos)?)\s+(?:otra|otro)\s+(?:proveedor|opci[oó]n|alternativa|empresa)\b", "evaluando alternativas"),
    (r"\bquit(?:ar|en|amos)\s+(?:de\s+|el\s+)?servicio\b",                                  "quitar servicio"),
    (r"\b(?:demand(?:ar|aremos|a)|denunciar|denuncia)\b",                                    "amenaza demanda"),
    (r"\b(?:condusef|profeco|abogad[oa]s?)\b",                                               "regulador / abogados"),
    (r"\bsuspend(?:er|imos)\s+(?:el\s+)?pago\b",                                             "suspender pago"),
]

AGGRESSIVE_LANGUAGE: list[tuple[str, str]] = [
    (r"\b(?:basta\s+ya|ya\s+est(?:a|á)\s+bien|me\s+tienen\s+harto)\b",                       "frustración explícita"),
    (r"\b(?:p[eé]simo|nefasto|inaceptable|deplorable)\s+(?:servicio|atenci[oó]n|trato)\b",   "queja servicio fuerte"),
    (r"\bes\s+una\s+(?:burla|verg[uü]enza|ofensa|falta\s+de\s+respeto)\b",                   "tono ofensivo"),
    (r"\bpor\s+(?:ene|en[eé]sima)\s+vez\b",                                                   "queja recurrente expresada"),
    (r"\bno\s+es\s+posible\s+que\b",                                                          "frustración acumulada"),
    (r"\b(?:llevo|llevamos|tengo|tenemos)\s+\d+\s+(?:d[ií]as|semanas|horas)\s+(?:esperando|sin\s+respuesta)\b", "sin respuesta acumulada"),
]

SERVICE_COMPLAINT: list[tuple[str, str]] = [
    (r"\b(?:no\s+sirve|no\s+funciona|no\s+responde\s+nadie|nadie\s+(?:responde|contesta))\b", "queja no respuesta"),
    (r"\b(?:siempre|todo\s+el\s+tiempo|cada\s+vez)\s+(?:lo\s+mismo|igual)\b",                 "queja repetitiva"),
    (r"\b(?:p[eé]rdida|perdimos|estamos\s+perdiendo)\s+(?:de\s+)?(?:dinero|clientes|ventas)\b", "impacto de negocio"),
]

PATTERN_GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    ("threat_to_leave",     THREAT_TO_LEAVE),
    ("aggressive_language", AGGRESSIVE_LANGUAGE),
    ("service_complaint",   SERVICE_COMPLAINT),
]

# Confidence per severity (deterministic keyword match → high confidence on
# threat_to_leave, lower on softer categories).
CONFIDENCE_BY_SEVERITY = {
    "threat_to_leave":     0.92,
    "aggressive_language": 0.78,
    "service_complaint":   0.62,
}


def _scan_text(text: str) -> tuple[str, str] | None:
    """Return (severity, matched_keyword) for the strongest match, or None."""
    if not text:
        return None
    lower = text.lower()
    for severity, patterns in PATTERN_GROUPS:
        for pat, label in patterns:
            if re.search(pat, lower, flags=re.IGNORECASE):
                return severity, label
    return None


def scan_recent_messages(*, lookback_hours: int = 4, limit: int = 2000) -> dict[str, Any]:
    """
    Scan client/operations messages from the last `lookback_hours` and
    persist any churn signals that haven't been recorded yet.

    Returns a dict with counts per severity for logging.
    """
    since = datetime.utcnow() - timedelta(hours=lookback_hours)

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.id, m.group_id, m.content, m.timestamp, m.sender_phone,
                   m.sender_display_name, m.sender_role,
                   (
                     SELECT i.id
                     FROM   incidents i
                     WHERE  i.group_id = m.group_id
                       AND  m.timestamp BETWEEN i.opened_at AND COALESCE(i.closed_at, NOW())
                     ORDER BY i.opened_at DESC
                     LIMIT 1
                   ) AS incident_id
            FROM messages m
            WHERE m.timestamp >= %s
              AND m.content IS NOT NULL
              AND LENGTH(m.content) BETWEEN 6 AND 1500
              -- Only client-side voices: clients + 'otro' (unmapped, often clients).
              -- Skip agente_99 to avoid flagging internal acknowledgements.
              AND COALESCE(m.sender_role, 'otro') IN ('cliente', 'otro')
            ORDER BY m.timestamp DESC
            LIMIT %s
            """,
            (since, limit),
        )
        rows = cur.fetchall()

    counts = {"threat_to_leave": 0, "aggressive_language": 0, "service_complaint": 0}
    saved = 0
    for r in rows:
        match = _scan_text(r["content"])
        if not match:
            continue
        severity, keyword = match
        try:
            sid = insert_churn_signal(
                group_id=r["group_id"],
                message_id=r["id"],
                incident_id=r.get("incident_id"),
                severity=severity,
                source="keyword",
                quote=r["content"][:600],
                matched_keyword=keyword,
                confidence=CONFIDENCE_BY_SEVERITY[severity],
                context=f"Detección por keyword '{keyword}' en mensaje del {r['timestamp'].strftime('%Y-%m-%d %H:%M')}",
                sender_phone=r["sender_phone"],
                sender_display_name=r["sender_display_name"],
                sender_role=r["sender_role"],
            )
            if sid > 0:
                saved += 1
                counts[severity] += 1
        except Exception as e:
            log.warning("churn_keyword_save_failed", message_id=r["id"], error=str(e))

    log.info(
        "churn_keyword_scan_done",
        scanned=len(rows),
        saved=saved,
        threats=counts["threat_to_leave"],
        aggressive=counts["aggressive_language"],
        complaints=counts["service_complaint"],
        lookback_hours=lookback_hours,
    )
    return {"scanned": len(rows), "saved": saved, **counts}


def persist_briefing_churn_signals(
    *, group_id: int, briefing_json: dict[str, Any]
) -> int:
    """
    Read `briefing_json['churn_signals']` (Sonnet output from the morning
    briefing) and upsert each one as a `source='morning_briefing'` row.
    """
    signals = briefing_json.get("churn_signals") or []
    if not signals:
        return 0

    saved = 0
    for s in signals:
        quote = (s.get("quote") or "").strip()
        if not quote:
            continue
        # Sonnet doesn't return message_id, so we leave it null and dedupe by
        # (group_id, severity='threat_to_leave', truncated quote).
        # (We always classify Sonnet's findings as threat_to_leave because its
        # prompt only emits actual churn-language quotes.)
        try:
            sid = insert_churn_signal(
                group_id=group_id,
                message_id=None,
                severity="threat_to_leave",
                source="morning_briefing",
                quote=quote[:600],
                matched_keyword=None,
                confidence=0.85,
                context=s.get("context") or "Detectado por análisis Sonnet del briefing matutino.",
                sender_phone=None,
                sender_display_name=None,
                sender_role="cliente",
            )
            if sid > 0:
                saved += 1
        except Exception as e:
            log.warning("churn_briefing_save_failed", error=str(e))

    log.info("churn_briefing_persist_done", group_id=group_id, saved=saved)
    return saved
