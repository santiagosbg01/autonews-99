# woi-analyzer

Pipeline batch de análisis con Claude. Corre 8pm CDMX.

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
# Correr el batch completo (clasifica + reconstruye incidents + calcula consistencia)
woi-analyze daily

# Solo clasificar (útil para debugging con limit)
woi-analyze classify --limit 20

# Solo reconstruir incidents en las últimas 96h
woi-analyze reconstruct --lookback-hours 96

# Ver consistencia Haiku↔Sonnet últimos 7 días
woi-analyze consistency --days 7

# Ver taxonomía activa (sanity check de seed data)
woi-analyze taxonomy
```

## Qué hace

1. **classify**: toma todos los mensajes con `analyzed=false`, los clasifica con Claude Haiku 4.5, persiste en `analysis`. Un subsample aleatorio (default 100/día) se re-clasifica con Sonnet y persiste en `ground_truth_samples` para medir consistencia.
2. **reconstruct**: agrupa mensajes clasificados en `incidents` usando heurística simple (open/close flags + ventana 72h). El módulo es reemplazable después del T0 spike.
3. **daily**: corre 1 + 2 + calcula `haiku_consistency_pct` del día.

## Modelos

- `CLAUDE_HAIKU_MODEL` (default `claude-haiku-4-5`) — clasificación masiva
- `CLAUDE_SONNET_MODEL` (default `claude-sonnet-4-5`) — ground-truth + resumen diario

Actualizar la env var sin tocar código si Anthropic lanza nueva versión.

## Prompt caching

- `classification_system.md` va en bloque `system` con `cache_control: ephemeral`.
- `few_shot_examples.md` + contexto del mensaje van en `user` (no cacheado, rota cada semana sin invalidar cache).

## Métricas de control

- `haiku_consistency_pct` — % de mensajes en `ground_truth_samples` donde Haiku y Sonnet coinciden en categoría.
- Target V1: ≥70% semana 4, ≥80% semana 8.

## Cron (launchd en macOS)

Ver `scripts/launchd/com.woi.analyzer.plist` para registrar el job diario.
