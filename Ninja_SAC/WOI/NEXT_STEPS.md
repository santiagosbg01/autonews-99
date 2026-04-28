# WOI · Próximos pasos

> Última actualización: 2026-04-16
> Contexto: Scaffold completo entregado (56 archivos). Listo para deployment.
> Aprobación: PRD v1.1 aprobado + código base aprobado.

---

## Estado actual

- [x] PRD v1.1 escrito y aprobado (`PRD-v1.1.md`)
- [x] Scaffold completo de los 6 componentes (listener, analyzer, reporter, UI, spike, docs)
- [x] Migrations SQL listas para aplicar
- [x] Launchd plists + setup scripts listos
- [ ] **Nada está desplegado todavía**

---

## Pendientes previos al deployment (tú — Santi)

### 1. Credenciales y cuentas externas

- [ ] **Supabase**: crear proyecto Pro ($25/mes) en supabase.com
  - [ ] Crear bucket privado `woi-auth-backup` en Storage
  - [ ] Copiar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` al `.env`
- [ ] **Anthropic**: crear API key en console.anthropic.com
  - [ ] Confirmar slug exacto de Sonnet disponible hoy (todo el pipeline corre solo con Sonnet)
  - [ ] Ajustar `CLAUDE_SONNET_MODEL` en `.env` si Anthropic publicó una versión nueva
  - [ ] Setear presupuesto/alerta en ~$200/mes (volumen Sonnet-only es mayor que el approach Haiku+Sonnet original)
- [ ] **Slack**:
  - [ ] Crear Slack App con Incoming Webhook (o usar uno existente)
  - [ ] Generar webhook para DM Santi o canal privado `#woi-daily`
  - [ ] (Opcional) webhook separado para `SLACK_HEALTHCHECK_WEBHOOK`
- [ ] **Google Cloud**:
  - [ ] Crear service account con scopes `spreadsheets` + `drive`
  - [ ] Descargar JSON → guardarlo como `google-credentials.json` en la raíz del repo WOI
  - [ ] Crear Google Sheet "WOI Daily Reports", compartirlo con el email del SA (Editor)
  - [ ] Copiar Sheet ID al `.env` (`GOOGLE_SHEETS_REPORT_ID`)
- [ ] **SIM WhatsApp**:
  - [ ] Adquirir número primario dedicado (no usar tu personal)
  - [ ] Adquirir número standby (para el día que baneen el primario)
  - [ ] Registrarlos en `.env` en `LISTENER_SIM_PHONE` y `LISTENER_SIM_STANDBY_PHONE`

### 2. `.env` lleno

- [ ] `cp .env.example .env` y llenar **todas** las variables requeridas
- [ ] Definir `STREAMLIT_PASSWORD` (una contraseña fuerte para la UI de onboarding)

### 3. Infra host

- [ ] Verificar en Mac Mini: Node 20+, Python 3.12+, `psql` client, `pm2` global
- [ ] Asegurar que el Mac Mini esté conectado a energía + red estable 24/7

---

## Ejecución del deployment (cuando tengas todo lo de arriba)

### Día 1 — Infra base

1. [ ] `cd /Users/Santiago/Desktop/Ai/Ninja_SAC/WOI`
2. [ ] `bash scripts/setup.sh` (instala deps de los 4 proyectos)
3. [ ] Aplicar migrations:
   ```
   psql "$SUPABASE_DB_URL" -f supabase/migrations/001_initial_schema.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/002_taxonomy_seed.sql
   ```
4. [ ] Smoke test DB: `woi-analyze taxonomy` debe imprimir las 21 categorías
5. [ ] Escanear QR del listener: `cd woi-listener && npm run qr` en el SIM primario
6. [ ] Confirmar "Connection OPEN" en logs → Ctrl+C
7. [ ] Levantar PM2: `npm run pm2:start && pm2 save && pm2 startup`
8. [ ] Instalar launchd: `bash scripts/install-launchd.sh`

### Día 2 — Primer grupo piloto

1. [ ] Agregar el número listener a **1 solo grupo interno** (no más)
2. [ ] Esperar 30 min, verificar ingesta:
   ```
   SELECT COUNT(*) FROM messages;
   SELECT name, pilot_cohort FROM groups;
   ```
3. [ ] Abrir UI de onboarding: `cd woi-onboarding-ui && streamlit run app.py`
4. [ ] Login con `STREAMLIT_PASSWORD`
5. [ ] Pestaña Grupos → ajustar TZ, país, vertical, cohort, HubSpot ID → guardar
6. [ ] Pestaña Participantes → marcar cada persona como cliente/agente_99/otro → confirmar

### Día 3-4 — Validar pipeline end-to-end

1. [ ] Esperar acumulación de 200-500 mensajes
2. [ ] Correr manualmente (antes de esperar al cron):
   ```
   cd woi-analyzer && .venv/bin/woi-analyze daily
   cd ../woi-reporter && .venv/bin/woi-report run
   ```
3. [ ] Verificar que llegó Slack con link y que el Sheet tiene los 6 tabs
4. [ ] Validar 5-10 clasificaciones en `RawSample_` manualmente (¿tiene sentido?)
5. [ ] Si hay errores evidentes de categoría → actualizar `few_shot_examples.md` y volver a correr

### Semana 1-2 — T0 Spike

1. [ ] Acumular 7-10 días de data en 1-2 grupos internos
2. [ ] `python woi-spike/scripts/export_sample.py --group-id X --limit 500 --out sample.json`
3. [ ] Santi labelea manualmente los 500 mensajes en el CSV template (1-2 horas)
4. [ ] `python woi-spike/scripts/evaluate_heuristic.py --gt-csv ground_truth_filled.csv`
5. [ ] Anotar F1 y decidir: mantener / mejorar / reemplazar el incident reconstructor
6. [ ] Documentar resultado en `docs/incident-reconstruction-spike.md`

---

## Bloques opcionales que quedaron pendientes (decidir después)

- [ ] **Smoke test end-to-end automatizado** (`tests/e2e_smoke.py`): script que inserta fixtures de mensajes, corre analyzer + reporter, y verifica que llega Slack + Sheet tiene data. Útil antes de onboardar grupo #2.
- [ ] **Ingesta del feedback Sheet → `classification_feedback`**: un pequeño script que lee las columnas donde Santi marca OK/NOK/recategorizar y persiste a Supabase para alimentar el loop semanal de few-shot. Versión V1.5, no bloquea lanzamiento.
- [ ] **Prompt tuning después de semana 2**: si el spot-check humano sobre `RawSample_*` muestra accuracy <85%, analizar los errores recurrentes y añadir 5-10 few-shots nuevos al prompt de Sonnet.
- [ ] **Plan B VPS (Hetzner)**: `docs/migration-to-vps.md` queda sin escribir. Solo crear si el Mac Mini falla por razones operativas o físicas.
- [ ] **Google Sheet de feedback separado** (`GOOGLE_SHEETS_FEEDBACK_ID` en `.env.example`): queda sin usar en V1. Opcional en V1.5.

---

## Conversaciones previas relevantes

- [Review y refinamiento PRD v1.1](4060f938-5767-4dbf-ad53-bfb36a24583a)

---

## Preguntas abiertas para mañana

1. ¿Ya tienes los SIMs en mano o falta comprarlos?
2. ¿Cuál será el primer grupo interno de prueba (nombre específico)?
3. ¿Quieres que mañana empecemos preparando el smoke test automatizado, o entras directo a deployment con el scaffold que ya está?
4. ¿Quieres que el reporter también loguee a un segundo canal de Slack solo con métricas de salud del sistema (mensajes ingested, % consistency, costo del día), separado del brief de producto?
