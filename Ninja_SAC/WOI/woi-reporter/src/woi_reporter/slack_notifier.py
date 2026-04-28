"""Envía mensaje resumido a Slack DM de Santi con link al Google Sheet."""

from __future__ import annotations

from datetime import date
from typing import Any

import requests

from woi_reporter.config import CFG


def build_message(
    report_date: date,
    overview: dict,
    sheet_url: str,
    groups_at_risk: list[dict],
    top_incidents: list[dict],
    agents_red: list[dict],
) -> dict[str, Any]:
    """Construye bloques de Slack (Block Kit)."""
    total = overview.get("total", 0)
    ratio_b = overview.get("ratio_b_pct") or 0

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"WOI · {report_date.isoformat()}"},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*Volumen:* {total} mensajes · "
                    f"A={overview.get('count_a',0)} "
                    f"B={overview.get('count_b',0)} "
                    f"C={overview.get('count_c',0)} · "
                    f"*Ratio B = {ratio_b}%*"
                ),
            },
        },
    ]

    # Grupos en riesgo
    if groups_at_risk:
        lines = []
        for g in groups_at_risk[:5]:
            lines.append(
                f"• *{g.get('name')}* — {g.get('ratio_b_pct')}% "
                f"({g.get('count_b')} inc, sent {g.get('sentiment_avg')})"
            )
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "*Grupos a vigilar (ratio B >25%):*\n" + "\n".join(lines)},
            }
        )

    # Top incidencias
    if top_incidents:
        lines = []
        for i in top_incidents[:5]:
            hours = round(i.get("open_hours") or 0, 1)
            lines.append(
                f"{i.get('category')} · {hours}h · {i.get('urgency')} · "
                f"{i.get('group_name')} · sent {i.get('sentiment_avg')}"
            )
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "*Top incidencias abiertas:*\n" + "\n".join(f"• {l}" for l in lines)},
            }
        )

    # Agentes zona roja
    if agents_red:
        lines = [
            f"• {a.get('agent_name')} — {a.get('incidents_attended')} inc, TTFR {a.get('ttfr_avg_min')}min"
            for a in agents_red[:5]
        ]
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "*Agentes en zona roja (TTFR >30min):*\n" + "\n".join(lines)},
            }
        )
    else:
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "*Agentes en zona roja:* ninguno."},
            }
        )

    # Link al sheet
    blocks.append({"type": "divider"})
    blocks.append(
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"<{sheet_url}|Abrir Google Sheet con detalle completo>",
            },
        }
    )

    return {"blocks": blocks, "text": f"WOI daily · {report_date.isoformat()}"}


def post_to_slack(payload: dict[str, Any]) -> bool:
    try:
        resp = requests.post(CFG.slack_webhook_url, json=payload, timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        import structlog
        structlog.get_logger().error("slack_post_failed", error=str(e))
        return False
