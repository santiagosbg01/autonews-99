"""Carga de configuración desde .env en la raíz del repo WOI."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.stderr.write(f"[config] Missing required env var: {name}\n")
        sys.exit(1)
    return val


@dataclass(frozen=True)
class SupabaseCfg:
    url: str
    service_role_key: str
    db_url: str


@dataclass(frozen=True)
class AnthropicCfg:
    api_key: str
    haiku_model: str
    sonnet_model: str
    max_tokens_classify: int
    max_tokens_summary: int


@dataclass(frozen=True)
class AnalyzerCfg:
    batch_size: int
    ground_truth_daily_sample: int
    context_messages: int
    run_hour_cdmx: int
    feature_incident_reconstruction: bool
    feature_ground_truth: bool


@dataclass(frozen=True)
class Config:
    supabase: SupabaseCfg
    anthropic: AnthropicCfg
    analyzer: AnalyzerCfg


def load_config() -> Config:
    return Config(
        supabase=SupabaseCfg(
            url=_require("SUPABASE_URL"),
            service_role_key=_require("SUPABASE_SERVICE_ROLE_KEY"),
            db_url=_require("SUPABASE_DB_URL"),
        ),
        anthropic=AnthropicCfg(
            api_key=_require("ANTHROPIC_API_KEY"),
            haiku_model=os.environ.get("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5"),
            sonnet_model=os.environ.get("CLAUDE_SONNET_MODEL", "claude-sonnet-4-5"),
            max_tokens_classify=int(os.environ.get("CLAUDE_MAX_TOKENS_CLASSIFY", "400")),
            max_tokens_summary=int(os.environ.get("CLAUDE_MAX_TOKENS_SUMMARY", "2000")),
        ),
        analyzer=AnalyzerCfg(
            batch_size=int(os.environ.get("ANALYZER_BATCH_SIZE", "50")),
            ground_truth_daily_sample=int(os.environ.get("ANALYZER_GROUND_TRUTH_DAILY_SAMPLE", "100")),
            context_messages=int(os.environ.get("ANALYZER_CONTEXT_MESSAGES", "3")),
            run_hour_cdmx=int(os.environ.get("ANALYZER_RUN_HOUR_CDMX", "20")),
            feature_incident_reconstruction=(
                os.environ.get("FEATURE_INCIDENT_RECONSTRUCTION", "true").lower() == "true"
            ),
            feature_ground_truth=(
                os.environ.get("FEATURE_GROUND_TRUTH_SAMPLING", "true").lower() == "true"
            ),
        ),
    )


CONFIG = load_config()
