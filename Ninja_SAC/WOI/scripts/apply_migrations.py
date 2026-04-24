#!/usr/bin/env python3
"""
Apply WOI migrations to Supabase.

Reads SUPABASE_DB_URL from .env, applies migration files in order,
runs a smoke test, and prints a summary.

Usage:
    python3 scripts/apply_migrations.py

Idempotency: scripts use IF NOT EXISTS / ON CONFLICT, so re-running is safe.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"


def load_db_url() -> str:
    if not ENV_FILE.exists():
        sys.exit(f"ERROR: missing {ENV_FILE}")
    env = dotenv_values(ENV_FILE)
    url = env.get("SUPABASE_DB_URL", "").strip()
    if not url or url.startswith("PEGAR_AQUI") or url.startswith("PENDIENTE"):
        sys.exit("ERROR: SUPABASE_DB_URL not set in .env")
    return url


def apply_file(cur, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    print(f"  → applying {path.name} ({len(sql):,} chars, {sql.count(chr(10))} lines)")
    cur.execute(sql)


def smoke_test(cur) -> dict:
    cur.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM information_schema.tables
             WHERE table_schema = 'public') AS tables,
          (SELECT COUNT(*) FROM information_schema.views
             WHERE table_schema = 'public') AS views,
          (SELECT COUNT(*) FROM taxonomy)        AS taxonomy_rows
        """
    )
    row = cur.fetchone()
    return {"tables": row[0], "views": row[1], "taxonomy_rows": row[2]}


def main() -> int:
    db_url = load_db_url()
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        sys.exit(f"ERROR: no migration files in {MIGRATIONS_DIR}")

    print(f"Connecting to Supabase pooler...")
    conn = psycopg2.connect(db_url, connect_timeout=15)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            print(f"Applying {len(files)} migrations:")
            for f in files:
                apply_file(cur, f)
            conn.commit()
            print("Commit OK.\n")

            print("Smoke test:")
            stats = smoke_test(cur)
            for k, v in stats.items():
                print(f"  {k:<20} = {v}")

            cur.execute(
                """
                SELECT bucket, bucket_label, COUNT(*) AS n
                FROM taxonomy
                GROUP BY bucket, bucket_label
                ORDER BY bucket
                """
            )
            print("\nTaxonomy by bucket:")
            for bucket, label, n in cur.fetchall():
                print(f"  [{bucket}] {label}: {n} categorías")
    except Exception as e:
        conn.rollback()
        print(f"\nFAIL: {e}")
        return 1
    finally:
        conn.close()

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
