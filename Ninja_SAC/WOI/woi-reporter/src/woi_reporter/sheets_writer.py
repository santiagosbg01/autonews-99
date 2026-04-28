"""Escritor al Google Sheet del reporte diario. Crea/actualiza 6 tabs."""

from __future__ import annotations

from datetime import date
from typing import Any

import gspread
from google.oauth2.service_account import Credentials

from woi_reporter.config import CFG

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _client() -> gspread.Client:
    creds = Credentials.from_service_account_file(CFG.sheets_credentials_path, scopes=SCOPES)
    return gspread.authorize(creds)


def _get_or_create_worksheet(sheet: gspread.Spreadsheet, title: str, rows: int, cols: int) -> gspread.Worksheet:
    try:
        ws = sheet.worksheet(title)
        ws.clear()
        return ws
    except gspread.WorksheetNotFound:
        return sheet.add_worksheet(title=title, rows=rows, cols=cols)


def _fmt_number(n: Any) -> Any:
    if n is None:
        return ""
    if isinstance(n, float):
        return round(n, 2)
    return n


def _hours(seconds: int | None) -> str:
    if seconds is None:
        return ""
    mins = seconds / 60
    if mins < 60:
        return f"{mins:.1f}min"
    return f"{mins/60:.1f}h"


def write_report(
    report_date: date,
    overview: dict,
    incidents: list[dict],
    agents_red: list[dict],
    agents_leaderboard: list[dict],
    groups_health: list[dict],
    raw_sample: list[dict],
    narrative: str,
) -> str:
    """Escribe todos los tabs y devuelve la URL del sheet."""
    sheet = _client().open_by_key(CFG.sheets_report_id)
    date_str = report_date.isoformat()

    # ---- TAB: Overview ----
    ws = _get_or_create_worksheet(sheet, f"Overview_{date_str}", rows=50, cols=8)
    ws.update(
        [
            ["WOI Daily Brief", date_str],
            [],
            ["Métrica", "Valor"],
            ["Total mensajes", overview.get("total", 0)],
            ["Bucket A (positivos)", overview.get("count_a", 0)],
            ["Bucket B (incidencias)", overview.get("count_b", 0)],
            ["Bucket C (conversacional)", overview.get("count_c", 0)],
            ["Ratio B (%)", _fmt_number(overview.get("ratio_b_pct"))],
            ["Sentiment avg", _fmt_number(overview.get("sentiment_avg"))],
            [],
            ["— Narrativa (Sonnet) —"],
            [narrative or "(no narrative generated)"],
        ],
        range_name="A1",
    )
    ws.format("A1:B1", {"textFormat": {"bold": True, "fontSize": 14}})
    ws.format("A3:B3", {"textFormat": {"bold": True}})

    # ---- TAB: Incidents_Today ----
    ws = _get_or_create_worksheet(sheet, f"Incidents_{date_str}", rows=200, cols=10)
    header = [
        "ID", "Grupo", "Cohorte", "Abierta hace (h)", "Categoría", "Urgencia",
        "Sentiment avg", "Owner (phone)", "Msgs", "Resumen",
    ]
    rows = [header]
    for i in incidents:
        rows.append([
            i.get("id"),
            i.get("group_name"),
            i.get("pilot_cohort"),
            round(i.get("open_hours") or 0, 1),
            i.get("category"),
            i.get("urgency"),
            _fmt_number(i.get("sentiment_avg")),
            (i.get("owner_phone") or "")[-6:],
            i.get("message_count"),
            (i.get("summary") or "")[:150],
        ])
    ws.update(rows, range_name="A1")
    ws.format("A1:J1", {"textFormat": {"bold": True}})

    # ---- TAB: Groups_Health ----
    ws = _get_or_create_worksheet(sheet, f"Groups_{date_str}", rows=100, cols=10)
    header = [
        "Grupo", "País", "TZ", "Cohorte", "Total", "A", "B", "C",
        "Ratio B %", "Sentiment avg",
    ]
    rows = [header]
    for g in groups_health:
        rows.append([
            g.get("name"),
            g.get("country"),
            g.get("timezone"),
            g.get("pilot_cohort"),
            g.get("total"),
            g.get("count_a"),
            g.get("count_b"),
            g.get("count_c"),
            _fmt_number(g.get("ratio_b_pct")),
            _fmt_number(g.get("sentiment_avg")),
        ])
    ws.update(rows, range_name="A1")
    ws.format("A1:J1", {"textFormat": {"bold": True}})

    # ---- TAB: Agents_Leaderboard ----
    ws = _get_or_create_worksheet(sheet, f"Agents_{date_str}", rows=100, cols=8)
    header = [
        "Agente", "Phone", "Incidencias atendidas (7d)", "TTFR avg (min)",
        "TTR avg (min)", "Resueltos", "Resolución %", "Zona roja?",
    ]
    rows = [header]
    red_phones = {a.get("agent_phone") for a in agents_red}
    for a in agents_leaderboard:
        phone = a.get("agent_phone")
        rows.append([
            a.get("agent_name"),
            (phone or "")[-6:],
            a.get("incidents_attended"),
            _fmt_number(a.get("ttfr_avg_min")),
            _fmt_number(a.get("ttr_avg_min")),
            a.get("resolved_count"),
            _fmt_number(a.get("resolution_rate_pct")),
            "SÍ" if phone in red_phones else "",
        ])
    ws.update(rows, range_name="A1")
    ws.format("A1:H1", {"textFormat": {"bold": True}})

    # ---- TAB: Raw_Sample (feedback loop) ----
    ws = _get_or_create_worksheet(sheet, f"RawSample_{date_str}", rows=50, cols=12)
    header = [
        "MsgID", "Grupo", "Timestamp", "Rol", "Autor", "Mensaje",
        "Categoría (Sonnet)", "Bucket", "Sentiment", "Urgencia", "Razonamiento",
        "Santi OK/NOK/recategorizar →",
    ]
    rows = [header]
    for m in raw_sample:
        rows.append([
            m.get("id"),
            m.get("group_name"),
            str(m.get("timestamp"))[:19],
            m.get("sender_role"),
            (m.get("sender_display_name") or "")[:30],
            (m.get("content") or "")[:200],
            m.get("category"),
            m.get("bucket"),
            _fmt_number(m.get("sentiment")),
            m.get("urgency"),
            (m.get("reasoning") or "")[:120],
            "",  # Santi llena aquí
        ])
    ws.update(rows, range_name="A1")
    ws.format("A1:L1", {"textFormat": {"bold": True}})
    ws.format("L2:L50", {"backgroundColor": {"red": 1.0, "green": 0.98, "blue": 0.85}})

    return sheet.url
