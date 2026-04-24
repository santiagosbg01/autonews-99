#!/usr/bin/env python3
"""Quick read-only smoke test of WOI Supabase schema."""
from __future__ import annotations
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
env = dotenv_values(ROOT / ".env")
url = env.get("SUPABASE_DB_URL", "").strip()
if not url:
    sys.exit("ERROR: SUPABASE_DB_URL missing in .env")

conn = psycopg2.connect(url, connect_timeout=15)
with conn.cursor() as cur:
    cur.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    )
    tables = [r[0] for r in cur.fetchall()]
    print(f"Tables ({len(tables)}):")
    for t in tables:
        print(f"  - {t}")

    cur.execute(
        """
        SELECT table_name FROM information_schema.views
        WHERE table_schema = 'public'
        ORDER BY table_name
        """
    )
    views = [r[0] for r in cur.fetchall()]
    print(f"\nViews ({len(views)}):")
    for v in views:
        print(f"  - {v}")

    cur.execute(
        """
        SELECT bucket, bucket_label, COUNT(*) AS n
        FROM taxonomy
        GROUP BY bucket, bucket_label
        ORDER BY bucket
        """
    )
    rows = cur.fetchall()
    total = sum(r[2] for r in rows)
    print(f"\nTaxonomy ({total} categories):")
    for bucket, label, n in rows:
        print(f"  [{bucket}] {label}: {n}")

conn.close()
print("\nOK.")
