# woi-reporter

Genera el reporte diario: actualiza Google Sheet con 6 tabs y envía DM a Slack con link.

## Setup

```bash
cd woi-reporter
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Google Sheets setup (una sola vez)

1. Crear un **Service Account** en Google Cloud Console.
2. Descargar el JSON de credenciales → guardarlo como `google-credentials.json` en la raíz del repo WOI.
3. Crear un Google Sheet vacío llamado "WOI Daily Reports".
4. **Compartir el Sheet con el email del service account** (role: Editor).
5. Copiar el sheet ID de la URL → `GOOGLE_SHEETS_REPORT_ID` en `.env`.

### Slack setup

1. Crear un Slack App en api.slack.com/apps → activar Incoming Webhooks.
2. Generar webhook URL para DM a Santi (o canal privado `#woi-daily`).
3. `SLACK_WEBHOOK_URL` en `.env`.

## Uso

```bash
# Reporte de hoy (en CDMX)
woi-report run

# Reporte de una fecha específica
woi-report run --for-date 2026-04-15
```

## Tabs que genera en el Sheet (6 tabs por día)

| Tab | Contenido |
|---|---|
| `Overview_YYYY-MM-DD` | KPIs + narrativa Sonnet + consistencia Haiku↔Sonnet |
| `Incidents_YYYY-MM-DD` | Top incidencias abiertas ordenadas por urgencia |
| `Groups_YYYY-MM-DD` | Health por grupo: volumen, ratio B, sentiment |
| `Agents_YYYY-MM-DD` | Leaderboard 7d con flag zona roja |
| `RawSample_YYYY-MM-DD` | 20 mensajes aleatorios clasificados, columna para Santi marcar OK/NOK |
| `Diffs_YYYY-MM-DD` | Mensajes donde Haiku y Sonnet difieren, para revisión |

## Slack output

Mensaje resumido con Block Kit: volumen, top 5 grupos en riesgo, top 5 incidencias, agentes en zona roja, consistencia, y link al Sheet.

## Cron (9pm CDMX)

Ver `scripts/launchd/com.woi.reporter.plist`.
