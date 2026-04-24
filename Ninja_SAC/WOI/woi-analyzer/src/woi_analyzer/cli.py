"""CLI para operar el analyzer manualmente."""

from __future__ import annotations

import json
import sys

import click

from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.daily_batch import run_daily_batch
from woi_analyzer.db import compute_haiku_consistency, fetch_taxonomy
from woi_analyzer.group_analyst import run_group_analysis_batch
from woi_analyzer.incident_reconstructor import reconstruct_recent_incidents
from woi_analyzer.kpi_snapshotter import run_kpi_snapshot


@click.group()
def main():
    """WOI Analyzer CLI."""
    pass


@main.command()
@click.option("--limit", type=int, default=None, help="Max messages to classify")
@click.option("--group", type=str, default=None, help="Filtrar por nombre de grupo (parcial, ej: 'CDMX')")
def classify(limit: int | None, group: str | None) -> None:
    """Run classification batch on unanalyzed messages."""
    result = run_classification_batch(limit=limit, group_name=group)
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


@main.command("analyze-groups")
@click.option("--window-hours", type=int, default=2, help="Horas hacia atrás a analizar")
def analyze_groups(window_hours: int) -> None:
    """Run Sonnet group analysis for all active groups."""
    result = run_group_analysis_batch(window_hours=window_hours)
    click.echo(json.dumps(result, indent=2))


@main.command("snapshot-kpis")
def snapshot_kpis() -> None:
    """Save today's KPI snapshot for all active groups."""
    result = run_kpi_snapshot()
    click.echo(json.dumps(result, indent=2))


@main.command("analyze-media")
@click.option("--limit", type=int, default=50, help="Max images to process")
def analyze_media(limit: int) -> None:
    """Analyze images & documents with Claude Vision."""
    from woi_analyzer.media_analyzer import run_media_analysis_batch
    result = run_media_analysis_batch(limit=limit)
    click.echo(json.dumps(result, indent=2))


@main.command("schedule")
def schedule() -> None:
    """Start the production scheduler (runs hourly during work hours)."""
    from woi_analyzer.scheduler import main as run_scheduler
    run_scheduler()


if __name__ == "__main__":
    main()
