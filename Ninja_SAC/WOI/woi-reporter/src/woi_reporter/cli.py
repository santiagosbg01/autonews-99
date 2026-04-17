"""CLI para invocar el reporter manualmente."""

from __future__ import annotations

import json

import click

from woi_reporter.daily_report import run_daily_report


@click.group()
def main():
    """WOI Reporter CLI."""
    pass


@main.command()
@click.option("--for-date", type=str, default=None, help="YYYY-MM-DD en TZ CDMX; default=hoy")
def run(for_date: str | None) -> None:
    """Genera el reporte diario y entrega a Sheet + Slack."""
    result = run_daily_report(for_date=for_date)
    click.echo(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
