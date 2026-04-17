"""CLI para operar el analyzer manualmente."""

from __future__ import annotations

import json
import sys

import click

from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.daily_batch import run_daily_batch
from woi_analyzer.db import compute_haiku_consistency, fetch_taxonomy
from woi_analyzer.incident_reconstructor import reconstruct_recent_incidents


@click.group()
def main():
    """WOI Analyzer CLI."""
    pass


@main.command()
@click.option("--limit", type=int, default=None, help="Max messages to classify")
def classify(limit: int | None) -> None:
    """Run classification batch on unanalyzed messages."""
    result = run_classification_batch(limit=limit)
    click.echo(json.dumps(result.__dict__, indent=2))


@main.command()
@click.option("--lookback-hours", type=int, default=96)
def reconstruct(lookback_hours: int) -> None:
    """Reconstruct incidents from recent classified messages."""
    n = reconstruct_recent_incidents(lookback_hours=lookback_hours)
    click.echo(f"{n} incidents touched")


@main.command()
def daily() -> None:
    """Run the full daily batch: classify + reconstruct + consistency."""
    result = run_daily_batch()
    click.echo(json.dumps(result, indent=2, default=str))


@main.command()
@click.option("--days", type=int, default=7)
def consistency(days: int) -> None:
    """Print Haiku↔Sonnet consistency % for last N days."""
    pct = compute_haiku_consistency(days=days)
    if pct is None:
        click.echo("No ground_truth_samples available")
        sys.exit(2)
    click.echo(f"Haiku↔Sonnet consistency (last {days}d): {pct:.2f}%")


@main.command()
def taxonomy() -> None:
    """Print the active taxonomy."""
    t = fetch_taxonomy()
    click.echo(json.dumps(t, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
