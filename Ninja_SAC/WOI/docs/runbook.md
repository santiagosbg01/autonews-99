# WOI — Runbook operativo

Guía de operación diaria y disaster recovery.

---

## Inicio desde cero (primera instalación en Mac Mini)

### 1. Prereqs

```bash
# Verificar versiones
node --version    # >= 20
python3.12 --version
psql --version
```

Instalar PM2 globalmente:
```bash
npm install -g pm2
```

### 2. Clonar + .env

```bash
cd /Users/Santiago/Desktop/Ai/Ninja_SAC
# (repo WOI ya está aquí)
cd WOI
cp .env.example .env
```

Llenar `.env` con:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_STORAGE_BUCKET`
- `ANTHROPIC_API_KEY`, `CLAUDE_SONNET_MODEL`
- `SLACK_WEBHOOK_URL`, `SLACK_HEALTHCHECK_WEBHOOK`
- `GOOGLE_SHEETS_CREDENTIALS_PATH`, `GOOGLE_SHEETS_REPORT_ID`
- `STREAMLIT_PASSWORD`

### 3. Supabase setup

```bash
# Desde Supabase dashboard:
# - Crear proyecto (plan Pro)
# - Crear bucket 'woi-auth-backup' (privado) en Storage
# - Copiar DB URL a .env

# Aplicar migrations
psql "$SUPABASE_DB_URL" -f supabase/migrations/001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/002_taxonomy_seed.sql
```

### 4. Google Sheets setup

```bash
# En Google Cloud Console:
# - Crear service account
# - Descargar JSON → guardar como ./google-credentials.json en la raíz del repo
# - Crear Google Sheet "WOI Daily Reports"
# - Compartir con el email del service account (Editor)
# - Copiar sheet ID a .env (GOOGLE_SHEETS_REPORT_ID)
```

### 5. Instalar todos los componentes

```bash
bash scripts/setup.sh
```

### 6. Escanear QR del SIM listener

```bash
cd woi-listener
npm run qr
# Abrir WhatsApp en el SIM dedicado
# Menú → Dispositivos vinculados → Vincular dispositivo
# Escanear QR
# Esperar "Connection OPEN"
# Ctrl+C
```

### 7. Levantar listener en PM2

```bash
cd woi-listener
npm run pm2:start
pm2 save
pm2 startup   # Seguir el comando sudo que imprime, una sola vez
```

### 8. Instalar launchd (cron jobs)

```bash
bash scripts/install-launchd.sh
```

Esto registra 3 jobs:
- `com.woi.analyzer` — 8pm CDMX diario
- `com.woi.reporter` — 9pm CDMX diario
- `com.woi.healthcheck` — cada 15 min

### 9. Onboarding UI y mapeo inicial

```bash
cd woi-onboarding-ui
streamlit run app.py
# Abrir http://localhost:8501
# Login con STREAMLIT_PASSWORD
```

Agregar el listener a 1-2 grupos internos de prueba. Esperar 5-10 min. Volver a la UI → Grupos → deberías verlo → configurar TZ, país, cohort=internal, vertical, HubSpot ID → guardar. Luego → Participantes → mapear cada uno.

---

## Operación diaria

| Hora | Qué pasa | Acción si falla |
|---|---|---|
| 24/7 | Listener corriendo en PM2, ingesta continua | `pm2 restart woi-listener` |
| 24/7 (c/15min) | Healthcheck externo | Ver `logs/healthcheck.log` |
| c/60min | Backup auth_state a Supabase Storage | Verificar en UI Supabase → Storage |
| 8pm CDMX | `woi-analyze daily` corre automáticamente | Ver `logs/analyzer.log`, revisar `daily_reports` table |
| 9pm CDMX | `woi-report run` corre automáticamente | Slack debe llegar; ver `logs/reporter.log` |

### Santi's daily routine

1. 9pm CDMX: revisar el mensaje de Slack, abrir el Sheet.
2. Tab `Overview_YYYY-MM-DD`: leer ratio B y narrativa.
3. Tab `Incidents_YYYY-MM-DD`: revisar top 3-5 incidencias abiertas.
4. Tab `RawSample_YYYY-MM-DD`: marcar 3-5 mensajes con OK/NOK/recategorizar (columna L). Esto alimenta el feedback loop semanal.

---

## Disaster Recovery

### Listener no conecta

```bash
# 1. Revisar logs
cd woi-listener
npm run pm2:logs

# 2. Intentar reconexión manual
npm run pm2:restart

# 3. Si auth_state está corrupto, restaurar del backup
npm run pm2:stop
rm -rf auth_state/
node src/scripts/restore-auth.js
npm run pm2:start

# 4. Si no hay backup, escanear QR fresco (pierde historial de membresía)
rm -rf auth_state/
npm run qr
npm run pm2:start
```

### Número listener baneado

```bash
# 1. Cambiar env var al SIM standby
# En .env:
#   LISTENER_SIM_PHONE=<standby_number>

# 2. Limpiar auth_state
cd woi-listener
npm run pm2:stop
rm -rf auth_state/

# 3. Escanear QR con el SIM standby
npm run qr

# 4. Agregar standby a los grupos — STAGGERED, 1 cada 2-3 días
#    NO hacer bulk-add o te banearán otra vez

# 5. Arrancar listener
npm run pm2:start
```

### Mac Mini se reinicia (update macOS u otros)

PM2 `pm2 startup` ya configuró auto-arranque. Verificar:

```bash
pm2 list       # Debe mostrar woi-listener con status "online"
launchctl list | grep com.woi  # Los 3 jobs deben estar listados
```

Si el listener no arrancó:
```bash
cd woi-listener && npm run pm2:start
```

### Job de analyzer no corrió

```bash
# Verificar logs
tail -100 logs/analyzer.log

# Correr manualmente
cd woi-analyzer
.venv/bin/woi-analyze daily

# Si el reporter falló porque el analyzer no corrió:
cd ../woi-reporter
.venv/bin/woi-report run
```

### Supabase caída o sin conexión

- El listener tiene retry logic pero si Supabase está caída >10min, va a fallar. Los mensajes NO se pierden en WhatsApp, pero tampoco se ingestan.
- Cuando Supabase vuelve, el listener sigue ingestando mensajes nuevos. Los mensajes perdidos durante el outage NO se recuperan.
- Mitigación futura (V1.5): queue local en SQLite con replay.

### Costos excedidos

```bash
# Verificar gastos en Anthropic Console
# Si Claude se disparó:
#   - Reducir contexto con ANALYZER_CONTEXT_MESSAGES=2
#   - Bajar ANALYZER_BATCH_SIZE para fragmentar runs
#   - Cambiar CLAUDE_SONNET_MODEL a un slug más barato si Anthropic publica uno
#   - Considerar batch API o cache TTL extendido si el spike es estructural
```

---

## Migración a VPS (plan B si Mac Mini se satura)

Hetzner CX22 ~$8/mes. Ver docs/migration-to-vps.md (pendiente, crear si llega el caso).

Resumen:
1. Aprovisionar Ubuntu 22.04 VPS
2. Instalar Node 20 + Python 3.12 + PM2 + launchd equivalente (systemd)
3. `rsync` de `auth_state/` al VPS
4. Deploy con mismo `.env` actualizado para host
5. Cambiar DNS de healthcheck + Slack URLs

---

## Checklist semanal (viernes 5pm)

- [ ] Revisar accuracy de Sonnet sobre los `RawSample_*` últimos 7d (spot-check Santi)
- [ ] Procesar thumbs up/down de `Raw_Sample` de la semana
- [ ] Actualizar few-shot examples en `woi-analyzer/src/woi_analyzer/prompts/few_shot_examples.md`
- [ ] Verificar costos Anthropic vs budget $200
- [ ] Revisar logs de healthcheck: cuántos failures hubo?
- [ ] Revisar Storage de `woi-auth-backup`: rotación correcta?
- [ ] Revisar grupos con `ratio_b_pct > 40%` por 3+ días seguidos (posible churn risk)

---

## Troubleshooting común

| Síntoma | Causa probable | Fix |
|---|---|---|
| "Missing required env var" al arrancar | `.env` no está o falta una var | Copiar `.env.example` → `.env` |
| Listener arranca pero no ingesta | QR no escaneado, auth_state vacío | `npm run qr` |
| Clasificación devuelve `otro` siempre | Prompt caching inválido o modelo incorrecto | Revisar `CLAUDE_SONNET_MODEL`, comparar slug contra el listado de Anthropic |
| TTFR sale siempre NULL | No hay participantes con role='agente_99' | Confirmar participantes en Onboarding UI |
| Ratio B siempre 0% | Participantes todos como 'otro' (ninguno cliente) | Confirmar clientes en Onboarding UI |
| Sheet vacío | Service account no tiene permisos | Compartir Sheet con email del SA |
| Slack no llega | Webhook inválido | Regenerar en Slack App y actualizar `.env` |
