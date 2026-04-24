#!/usr/bin/env python3
"""Verify Supabase Storage bucket woi-auth-backup is accessible with service_role key."""
from __future__ import annotations
import sys
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
env = dotenv_values(ROOT / ".env")

url = env["SUPABASE_URL"]
key = env["SUPABASE_SERVICE_ROLE_KEY"]
bucket_name = env.get("SUPABASE_STORAGE_BUCKET", "woi-auth-backup")

client = create_client(url, key)
buckets = client.storage.list_buckets()

print(f"Buckets visible to service_role ({len(buckets)}):")
for b in buckets:
    name = getattr(b, "name", None) or b.get("name") if isinstance(b, dict) else b.name
    public = getattr(b, "public", None) if not isinstance(b, dict) else b.get("public")
    flag = "PUBLIC" if public else "private"
    marker = "  <-- WOI" if name == bucket_name else ""
    print(f"  - {name} [{flag}]{marker}")

found = any(
    (getattr(b, "name", None) or (b.get("name") if isinstance(b, dict) else None)) == bucket_name
    for b in buckets
)
if not found:
    sys.exit(f"\nFAIL: bucket {bucket_name!r} not found")

print(f"\nWriting test object to {bucket_name}/_woi_health.txt ...", end=" ")
try:
    client.storage.from_(bucket_name).upload(
        "_woi_health.txt",
        b"woi-init-check",
        file_options={"content-type": "text/plain", "upsert": "true"},
    )
    print("OK")
except Exception as e:
    msg = str(e)
    if "Duplicate" in msg or "already exists" in msg:
        print("already exists (OK)")
    else:
        sys.exit(f"FAIL: {e}")

print(f"Removing test object ...", end=" ")
client.storage.from_(bucket_name).remove(["_woi_health.txt"])
print("OK")

print("\nStorage bucket OK.")
