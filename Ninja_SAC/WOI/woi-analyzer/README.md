# woi-analyzer

Pipeline batch de análisis con Claude **Sonnet** (modelo único). Corre 8pm CDMX
y, en producción, el scheduler lo dispara cada hora durante la ventana laboral.

## Setup

```bash
cd woi-analyzer
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
# o con uv:
# uv sync
```

## Uso

```bash
# Correr el batch completo (clasifica + reconstruye incidents + reporte diario)
woi-analyze daily

# Solo clasificar (útil para debugging con limit)
woi-analyze classify --limit 20

# Solo reconstruir incidents en las últimas 96h
woi-analyze reconstruct --lookback-hours 96

# Ver taxonomía activa (sanity check de seed data)
woi-analyze taxonomy
```

## Qué hace

1. **classify**: toma todos los mensajes con `analyzed=false`, los clasifica con
   Claude Sonnet y persiste en `analysis`.
2. **reconstruct**: agrupa mensajes clasificados en `incidents` usando heurística
   simple (open/close flags + ventana 72h). El módulo es reemplazable después
   del T0 spike.
3. **daily**: corre 1 + 2 + genera la narrativa Sonnet y la persiste en
   `daily_reports` para que el reporter la sirva al sheet/Slack.

## Modelo

- `CLAUDE_SONNET_MODEL` (default `claude-sonnet-4-6`) — usado para clasificación
  masiva, análisis horario por grupo, reconstrucción de incidentes (resúmenes y
  veredicto de resolución), morning briefing y narrativa diaria.

Actualizar la env var sin tocar código si Anthropic lanza una nueva versión.

## Prompt caching

- `classification_system.md` va en bloque `system` con `cache_control: ephemeral`.
- `few_shot_examples.md` + contexto del mensaje van en `user` (no cacheado, rota
  cada semana sin invalidar cache).

## Métricas de control

- Spot-check humano sobre el tab `RawSample_YYYY-MM-DD` del Google Sheet.
- Anomalías detectadas vía `analytics` (ratio B por grupo, sentiment avg,
  agentes en zona roja).

## Cron (launchd en macOS)

Ver `scripts/launchd/com.woi.analyzer.plist` para registrar el job diario.
