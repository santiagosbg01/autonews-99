"""CLI para operar el analyzer manualmente."""

from __future__ import annotations

import json
import sys

import click

from woi_analyzer.classifier import run_classification_batch
from woi_analyzer.daily_batch import run_daily_batch
from woi_analyzer.db import compute_haiku_consistency, fetch_taxonomy, reset_analyzed_flag
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
@click.option("--all", "all_history", is_flag=True, default=False, help="Reconstruye desde todos los mensajes históricos")
def reconstruct(lookback_hours: int, all_history: bool) -> None:
    """Reconstruct incidents from recent classified messages."""
    hours = 87600 if all_history else lookback_hours  # 10 years if --all
    n = reconstruct_recent_incidents(lookback_hours=hours)
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


@main.command("reset-analyzed")
@click.option("--group", type=str, default=None, help="Solo resetear mensajes de este grupo (parcial)")
@click.option("--since", type=str, default=None, help="Solo mensajes desde esta fecha ISO (ej: 2026-01-01)")
@click.option("--yes", is_flag=True, default=False, help="Confirmar sin prompt interactivo")
def reset_analyzed(group: str | None, since: str | None, yes: bool) -> None:
    """Marca mensajes como analyzed=FALSE para forzar re-clasificación."""
    from datetime import datetime, timezone
    since_dt = datetime.fromisoformat(since).replace(tzinfo=timezone.utc) if since else None
    scope = f"grupo={group!r}" if group else "TODOS los grupos"
    if since_dt:
        scope += f" desde {since}"
    if not yes:
        click.confirm(f"¿Resetear analyzed=FALSE en {scope}?", abort=True)
    count = reset_analyzed_flag(group_name=group, since=since_dt)
    click.echo(f"✅ {count} mensajes marcados como analyzed=FALSE — el scheduler los re-clasificará en el próximo ciclo.")


@main.command("reanalyze-all")
@click.option("--yes", is_flag=True, default=False, help="Confirmar sin prompt interactivo")
def reanalyze_all(yes: bool) -> None:
    """
    Pipeline completo de re-análisis:
      1. Resetea analyzed=FALSE en todos los mensajes
      2. Clasifica todos (Sonnet)
      3. Reconstruye todos los incidentes
      4. Re-corre análisis de grupos
      5. Toma snapshot de KPIs
    ADVERTENCIA: puede tardar varios minutos dependiendo del volumen de mensajes.
    """
    import json as _json
    from datetime import datetime, timezone
    if not yes:
        click.confirm(
            "⚠️  Esto re-clasificará TODOS los mensajes con Sonnet y puede tardar bastante. ¿Continuar?",
            abort=True,
        )

    click.echo("── 1/5  Reseteando flags analyzed …")
    count = reset_analyzed_flag()
    click.echo(f"    {count} mensajes marcados para re-análisis")

    click.echo("── 2/5  Clasificando con Sonnet …")
    result = run_classification_batch()
    click.echo(f"    done={result.done}  failed={result.failed}")

    click.echo("── 3/5  Reconstruyendo incidentes …")
    n = reconstruct_recent_incidents(lookback_hours=87600)
    click.echo(f"    {n} incidents touched")

    click.echo("── 4/5  Análisis de grupos …")
    ga = run_group_analysis_batch(window_hours=720)  # últimos 30 días
    click.echo(f"    {_json.dumps(ga)}")

    click.echo("── 5/5  Snapshot de KPIs …")
    kpi = run_kpi_snapshot()
    click.echo(f"    {_json.dumps(kpi)}")

    click.echo("✅ Re-análisis completo.")


@main.command("schedule")
def schedule() -> None:
    """Start the production scheduler (runs hourly during work hours)."""
    from woi_analyzer.scheduler import main as run_scheduler
    run_scheduler()


if __name__ == "__main__":
    main()
