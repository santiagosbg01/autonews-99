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
from woi_analyzer.kpi_snapshotter import backfill_kpi_snapshots, run_kpi_snapshot


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


@main.command("snapshot-kpis-backfill")
@click.option("--from", "from_date", type=str, required=True,
              help="Start date YYYY-MM-DD (inclusive)")
@click.option("--to", "to_date", type=str, default=None,
              help="End date YYYY-MM-DD (inclusive). Defaults to today.")
def snapshot_kpis_backfill(from_date: str, to_date: str | None) -> None:
    """Recompute group_kpi_snapshots for every day in [from, to]."""
    from datetime import date as date_t
    start = date_t.fromisoformat(from_date)
    end = date_t.fromisoformat(to_date) if to_date else None
    result = backfill_kpi_snapshots(start=start, end=end)
    click.echo(json.dumps(result, indent=2, default=str))


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


@main.command("briefing")
@click.option("--date", "date_str", type=str, default=None,
              help="Fecha local que cubre el briefing (YYYY-MM-DD). Default: ayer.")
@click.option("--group-id", "group_id", type=int, default=None,
              help="Genera el briefing solo para un grupo. Default: todos los grupos activos.")
@click.option("--all-groups", "all_groups", is_flag=True, default=False,
              help="Itera todos los grupos activos (ignora la verificación de hora local).")
@click.option("--global", "as_global", is_flag=True, default=False,
              help="Genera un briefing global legacy (sin group_id).")
def briefing(date_str: str | None, group_id: int | None, all_groups: bool, as_global: bool) -> None:
    """
    Genera el morning briefing.
    
    - sin flags  → corre 'due briefings' (igual que el scheduler hourly)
    - --group-id → un solo grupo (en cualquier hora)
    - --all-groups → itera todos los grupos activos
    - --global → briefing global (legacy)
    """
    from datetime import datetime
    from woi_analyzer.morning_briefing import run_morning_briefing, run_due_briefings

    target = datetime.fromisoformat(date_str) if date_str else None

    if as_global:
        result = run_morning_briefing(target_date=target, group_id=None)
    elif group_id is not None:
        result = run_morning_briefing(target_date=target, group_id=group_id)
    elif all_groups:
        result = run_due_briefings(force=True)
    else:
        result = run_due_briefings(force=False)

    click.echo(json.dumps(result, indent=2, default=str))


@main.command("churn-scan")
@click.option("--lookback-hours", type=int, default=24,
              help="Cuántas horas hacia atrás escanear (default 24).")
@click.option("--limit", type=int, default=5000,
              help="Máximo de mensajes a evaluar por corrida.")
def churn_scan(lookback_hours: int, limit: int) -> None:
    """Escanea mensajes recientes y persiste señales de churn-risk."""
    from woi_analyzer.churn_detector import scan_recent_messages
    result = scan_recent_messages(lookback_hours=lookback_hours, limit=limit)
    click.echo(json.dumps(result, indent=2, default=str))


@main.command("churn-list")
@click.option("--group-id", type=int, default=None, help="Solo este grupo.")
@click.option("--limit", type=int, default=20)
def churn_list(group_id: int | None, limit: int) -> None:
    """Lista las señales de churn-risk abiertas."""
    from woi_analyzer.db import list_open_churn_signals
    rows = list_open_churn_signals(group_id=group_id, limit=limit)
    if not rows:
        click.echo("(no hay señales abiertas)")
        return
    for r in rows:
        click.echo(
            f"#{r['id']:<5} [{r['severity']:<20}] {r['group_name']!s:<30} "
            f"{r['detected_at'].strftime('%Y-%m-%d %H:%M')!s:<18} "
            f"src={r['source']:<18} → {(r['quote'] or '')[:120]}"
        )


@main.command("schedule")
def schedule() -> None:
    """Start the production scheduler (runs hourly during work hours)."""
    from woi_analyzer.scheduler import main as run_scheduler
    run_scheduler()


if __name__ == "__main__":
    main()
