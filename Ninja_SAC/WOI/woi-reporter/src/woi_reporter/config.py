"""Config del reporter."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")


def _require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.stderr.write(f"[reporter.config] Missing required env: {name}\n")
        sys.exit(1)
    return v


@dataclass(frozen=True)
class ReporterCfg:
    db_url: str
    sheets_credentials_path: str
    sheets_report_id: str
    slack_webhook_url: str
    slack_channel_dm: str
    timezone: str
    top_incidents: int
    run_hour_cdmx: int


def load_reporter_config() -> ReporterCfg:
    return ReporterCfg(
        db_url=_require("SUPABASE_DB_URL"),
        sheets_credentials_path=_require("GOOGLE_SHEETS_CREDENTIALS_PATH"),
        sheets_report_id=_require("GOOGLE_SHEETS_REPORT_ID"),
        slack_webhook_url=_require("SLACK_WEBHOOK_URL"),
        slack_channel_dm=os.environ.get("SLACK_CHANNEL_DM_SANTI", "@santiago"),
        timezone=os.environ.get("REPORTER_TIMEZONE", "America/Mexico_City"),
        top_incidents=int(os.environ.get("REPORTER_TOP_INCIDENTS", "10")),
        run_hour_cdmx=int(os.environ.get("REPORTER_RUN_HOUR_CDMX", "21")),
    )


CFG = load_reporter_config()
