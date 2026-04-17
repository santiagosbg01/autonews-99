#!/usr/bin/env python
"""
Exporta N mensajes clasificados de los últimos 7 días de un grupo a JSON.
Uso:
    python scripts/export_sample.py --group-id 3 --limit 500 --out sample.json
"""

from __future__ import annotations

import json
from pathlib import Path

import click
import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")

import os

DB_URL = os.environ["SUPABASE_DB_URL"]


@click.command()
@click.option("--group-id", type=int, required=True)
@click.option("--limit", type=int, default=500)
@click.option("--out", type=click.Path(), default="spike_sample.json")
def main(group_id: int, limit: int, out: str) -> None:
    query = """
        SELECT
            m.id,
            m.timestamp,
            m.sender_phone,
            m.sender_role,
            m.sender_display_name,
            m.content,
            a.category,
            a.bucket,
            a.sentiment,
            a.urgency,
            a.is_incident_open,
            a.is_incident_close,
            a.incident_id
        FROM messages m
        LEFT JOIN analysis a ON a.message_id = m.id
        WHERE m.group_id = %s
          AND m.content IS NOT NULL
        ORDER BY m.timestamp ASC
        LIMIT %s
    """
    with psycopg.connect(DB_URL, row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute(query, (group_id, limit))
        rows = cur.fetchall()

    Path(out).write_text(json.dumps(rows, ensure_ascii=False, indent=2, default=str))
    print(f"Exported {len(rows)} messages to {out}")


if __name__ == "__main__":
    main()
