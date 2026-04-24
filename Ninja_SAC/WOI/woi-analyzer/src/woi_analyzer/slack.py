"""Envío de alertas a Slack via incoming webhook."""

from __future__ import annotations

import json
import urllib.request
from typing import Any

from woi_analyzer.config import CONFIG
from woi_analyzer.logging_setup import log

URGENCY_EMOJI = {"alta": ":red_circle:", "media": ":large_yellow_circle:", "baja": ":white_circle:"}


def send_slack_message(text: str, blocks: list[dict[str, Any]] | None = None) -> bool:
    """
    Envía un mensaje a Slack. Retorna True si fue exitoso.
    Si SLACK_WEBHOOK_URL no está configurado, solo loguea y retorna False.
    """
    url = CONFIG.analyzer.slack_webhook_url
    if not url:
        log.debug("slack_webhook_not_configured", message=text[:100])
        return False

    payload: dict[str, Any] = {"text": text}
    if blocks:
        payload["blocks"] = blocks

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            ok = resp.status == 200
            if not ok:
                log.warning("slack_send_failed", status=resp.status)
            return ok
    except Exception as e:
        log.warning("slack_send_error", error=str(e))
        return False


def alert_incident_opened(
    group_name: str,
    category: str,
    urgency: str,
    owner_phone: str,
    incident_id: int,
) -> None:
    """Alerta cuando se abre un incidente de urgencia media o alta."""
    if urgency == "baja":
        return
    emoji = URGENCY_EMOJI.get(urgency, ":white_circle:")
    text = (
        f"{emoji} *Incidente abierto* · {group_name}\n"
        f"Categoría: `{category}` · Urgencia: *{urgency.upper()}*\n"
        f"Cliente: `...{owner_phone[-4:]}` · ID: #{incident_id}"
    )
    send_slack_message(text)


def alert_daily_red_zone(agents: list[dict]) -> None:
    """Alerta cuando hay agentes con TTFR por encima del umbral al final del día."""
    if not agents:
        return
    threshold = CONFIG.analyzer.ttfr_alert_threshold_min
    lines = [f":large_red_square: *Agentes en zona roja (TTFR >{threshold}min) — reporte diario*"]
    for a in agents:
        name = a.get("agent_name") or a.get("agent_phone", "???")
        ttfr = a.get("avg_ttfr_min", "?")
        count = a.get("incidents_attended", "?")
        lines.append(f"• {name} — TTFR avg *{ttfr}min* ({count} incidencias)")
    send_slack_message("\n".join(lines))
