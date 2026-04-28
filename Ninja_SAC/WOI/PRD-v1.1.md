# WhatsApp Ops Intelligence (WOI) — PRD v1.1

**Proyecto:** Sistema automatizado de análisis de grupos de WhatsApp operativos de 99minutos
**Owner:** Santiago (CGO)
**Fecha:** Abril 2026
**Estado:** PRD v1.1 — 13 Open Questions resueltas. Listo para ejecución.
**Cambios vs v1:** ver sección "Decisions Log" al final del documento.

---

## PRD

### 1. Introducción / Overview

99minutos opera con 20-100 grupos de WhatsApp activos donde conviven clientes mid-market y cuentas clave con sus respectivos agentes de Key Accounts, Sales, Fulfillment, y Customer Service. Hoy, toda la operación cliente-equipo en estos canales es una caja negra: no hay visibilidad sobre tiempos de respuesta, tipos de incidencias recurrentes, sentiment del cliente, o quién en el equipo responde bien vs. mal.

**WOI** es un sistema automatizado que ingesta, analiza y reporta toda la actividad de los grupos de WhatsApp operativos de 99minutos, transformando conversaciones crudas en métricas accionables de SLA, health de cliente, y performance del equipo.

**Goal V1 (piloto interno):** Validar end-to-end captura → análisis → reporte sobre 5-10 grupos internos + cuentas con relación cercana, sin riesgo legal. V1.5 escala a externos con validación legal formal. V2 agrega sync HubSpot, alertas tiempo real, y scaling.

### 2. Goals (Measurable) — V1

1. Capturar 100% de mensajes de los grupos del piloto con latencia <60s desde envío a ingesta en DB.
2. Clasificar mensajes en 21 categorías (3 buckets: positivos, incidencias, conversacional) con Sonnet, validando **accuracy ≥85% vs spot-check humano** sobre el tab `RawSample_*` a 30 días de calibración.
3. Ratio Bucket B (incidencias) / total como métrica header diaria de health por grupo.
4. Medir TTFR (Time To First Response) por agente con granularidad de minuto, respetando timezone de cada grupo.
5. Reporte ejecutivo diario (9pm CDMX) entregado a Santi como **Google Sheet auto-actualizado + link en Slack** desde semana 3.
6. Uptime del listener ≥95% en V1, ≥99% en V1.5+.
7. Costo operativo mensual V1 <$80 USD (piloto 5-10 grupos).

### 3. User Stories — V1

**US-1:** Como Santi (CGO), quiero ver cada noche (9pm) un Google Sheet con las 5-10 situaciones del día que requieren atención, el ratio incidencias/total por grupo, y los agentes con TTFR en zona roja, para no tener que leer manualmente los grupos.

**US-2:** Como Santi, quiero ver el ranking semanal de agentes por TTFR y outcome de incidencias, para identificar quién necesita coaching.

**US-3:** Como analista (jr manager de CS), quiero explorar en el Sheet/Supabase incidencias por tipo, grupo, y agente, para detectar patrones operativos que alimenten fixes de producto.

**Out of V1 (mover a V1.5/V2):**
- Alertas en tiempo real a directores (V2).
- Sync a HubSpot con sentiment y incident count (V2).
- Correlación sentiment ↔ pipeline (V2).

### 4. Functional Requirements

**FR-1 — Captura (Baileys):**
- FR-1.1. Conexión a WhatsApp vía Baileys (Node.js) usando un número dedicado como listener.
- FR-1.2. Persistencia de sesión Baileys en disco **Y backup de `auth_state` a Supabase Storage cada 1h** para no perder auth en caso de corrupción.
- FR-1.3. Ingesta de todos los mensajes de los grupos donde el listener sea participante: texto, media metadata, reacciones, replies, timestamps.
- FR-1.4. Reconexión automática vía PM2 en caso de desconexión.
- FR-1.5. Listener nunca envía mensajes salientes en V1 (modo solo lectura).
- FR-1.6. **Eventos `messages.update` y `messages.delete` son IGNORADOS en V1**. El análisis trabaja con el snapshot original. Decisión a revisar en V1.5.
- FR-1.7. Segundo número SIM standby adquirido desde semana 1 para fallback si el primario es baneado.
- FR-1.8. Onboarding de grupos al listener debe ser **staggered** (no bulk-add) para reducir fingerprint de bot y minimizar riesgo de ban.

**FR-2 — Almacenamiento:**
- FR-2.1. Postgres (Supabase) con 6 tablas: `groups`, `participants`, `messages`, `analysis`, `incidents`, `classification_feedback`.
- FR-2.2. Mensajes raw con encryption at rest (default de Supabase).
- FR-2.3. **Política de retención V1: indefinida** (piloto interno, riesgo legal controlado). Política formal se redefine en V1.5 antes del primer grupo externo.
- FR-2.4. Cada participante mapeado a un `role` (cliente / agente_99 / otro) y un `hubspot_owner_id` si aplica. Llenado manual por Santi vía UI de onboarding.
- FR-2.5. Tabla `groups` incluye campo `timezone` (IANA, ej `America/Mexico_City`) para cálculos de TTFR y business hours por grupo.

**FR-3 — Análisis (Batch):**
- FR-3.1. Job diario **8pm CDMX** que procesa todos los mensajes de las últimas 24h no analizados.
- FR-3.2. Por cada mensaje, el sistema clasifica: **1 categoría de 21** (ver Appendix B), sentiment (-1 a +1), urgencia (baja/media/alta), e indicadores booleanos `is_incident_open` / `is_incident_close`.
- FR-3.3. **Modelo de producción:** Claude Sonnet (modelo más reciente disponible en API, configurable vía env `CLAUDE_SONNET_MODEL`) para todo el pipeline: clasificación masiva, análisis horario por grupo, reconstrucción/resúmenes de incidentes, morning briefing y narrativa diaria. No se usa Haiku — la duplicidad Haiku+Sonnet del piloto inicial fue reemplazada porque Sonnet a costo actual ofrece mejor accuracy operacional con sólo un modelo que mantener.
- FR-3.4. Prompt caching agresivo: system prompt estable (cached 5min+), few-shot examples en segundo bloque (no cached, rotables semanalmente sin invalidar cache).
- FR-3.5. Reconstrucción de `incidents`: agrupar mensajes en hilos lógicos (apertura → resolución) con timestamps de first_response, resolution, y agente responsable. **Spike técnico obligatorio semanas 1-2** sobre 500 mensajes reales antes de comprometer design final.
- FR-3.6. Spot-check manual de Santi: 50 mensajes aleatorios/semana sobre el tab `RawSample_*` para detectar sesgos sistemáticos del clasificador.

**FR-4 — Reporte ejecutivo diario:**
- FR-4.1. Trigger: **9pm CDMX**, después de que termine el job de análisis (8pm).
- FR-4.2. Entrega: Google Sheet auto-actualizado vía Sheets API + link en Slack DM a Santi.
- FR-4.3. Contenido del Sheet (tabs):
  - `Overview` — KPIs del día: volumen total, ratio B/total, top 3 grupos con más incidencias, agentes TTFR zona roja.
  - `Incidents_Today` — detalle de incidencias abiertas del día con summary (Sonnet).
  - `Groups_Health` — por grupo: message count, ratio B, sentiment avg, incidents abiertas.
  - `Agents_Leaderboard` — por agente: TTFR, TTR, outcome rate, volumen atendido.
  - `Raw_Sample` — muestra de 20 mensajes clasificados para que Santi haga spot-check.
- FR-4.4. Gmail HTML a directores y feedback loop con botones **OUT de V1** (se reevalúa en V1.5).

**FR-5 — Dashboard Looker Studio:**
- **OUT de V1.** El Google Sheet cubre las necesidades iniciales. Looker se evalúa en V1.5 si hay demanda real de exploración ad-hoc.

**FR-6 — Sync HubSpot:** OUT de V1 → V2.

**FR-7 — Alertas tiempo real:** OUT de V1 → V2.

**FR-8 — Feedback loop (simplificado):**
- FR-8.1. Santi puede marcar mensajes en el tab `Raw_Sample` del Sheet con thumbs up/down y comentario (columna simple de validación).
- FR-8.2. Script semanal lee el Sheet, ingesta a tabla `classification_feedback`, y propone actualización de few-shot examples.

**FR-9 — Onboarding UI:**
- FR-9.1. Mini-app (Streamlit o Next.js, a decidir en implementación) conectada a Supabase con 3 vistas:
  - Grupos: crear/editar `groups` (name, whatsapp_id, country, vertical, timezone, client_hubspot_id).
  - Participantes: listar participantes detectados por el listener, asignar `role` y `hubspot_owner_id`.
  - Health: vista resumen de último análisis por grupo, para validación manual rápida.
- FR-9.2. Auth simple (password único en env, solo Santi la usa).

### 5. Non-Goals (Out of Scope V1)

- Responder automáticamente a clientes en WhatsApp.
- Migrar grupos existentes a WhatsApp Business API oficial.
- Analizar conversaciones 1:1 de agentes con clientes (solo grupos).
- Transcripción de audio/video.
- OCR de imágenes.
- Traducción automática.
- Integración con CRM interno de 99minutos.
- App móvil.
- Análisis retroactivo.
- **Rollout a grupos con clientes externos sin consent verbal directo de Santi con el founder** (bloqueado hasta V1.5 con Legal formal).
- **Manejo de edits/deletes de mensajes.**
- **Dashboard Looker Studio.**
- **Email HTML y feedback loop con botones.**

### 6. Design Considerations

- **Entrega de reportes:** Google Sheet auto-actualizado como primer canal (simple, no requiere UI propietaria). Slack DM solo con link + 3 bullets de highlights.
- **Naming del número listener:** "99min Ops Monitor" con foto corporativa y bio "Bot de registro para calidad de servicio".
- **Idioma:** toda la salida en español por default.
- **Tono del reporte:** directo, sin fluff, estilo Santi (sin emojis, sin compliments, numerical framing).
- **Horario 9pm vs 6am:** cambio vs PRD v1. Reporte de cierre de día (9pm) es mejor que brief matutino porque Santi ve lo que pasó hoy cuando aún está fresco en la operación, y el equipo ya no está activo como para contaminar con mensajes nuevos mientras se genera.

### 7. Technical Considerations

- **Stack:** Node.js 20+ (Baileys), Python 3.12 (análisis + reporter), Supabase (Postgres + Storage), Anthropic API (Sonnet, modelo único), Google Sheets API, Slack webhook.
- **Host:** Mac Mini M4 (16GB). PM2 para Baileys, launchd para cron jobs Python.
- **Fallback:** segundo SIM standby desde semana 1. Si Mac Mini se satura → plan B Hetzner CX22 (~$8/mes) documentado pero no ejecutado en V1.
- **Secrets:** `.env` local + 1Password para backup. No se commitean.
- **Observabilidad:** logs rotados diarios, healthcheck cada 5min, ping a Slack si Baileys cae >2min o si job de análisis no produjo output a las 8:30pm.
- **Backup auth_state:** Baileys `auth_state` sincronizado a Supabase Storage cada 1h. Recovery procedure documentado en runbook.
- **Costo target V1:** <$200 USD/mes (Supabase Pro $25 + Claude Sonnet ~$160 + SIM $10 + misc). Sonnet-only sube el costo respecto al approach Haiku+Sonnet del PRD original, pero simplifica el pipeline y mejora accuracy operacional.
- **Legal V1:** piloto solo en grupos 99-internos + cuentas con founder amigo/conocido con consent verbal informal de Santi. NO se abre a clientes externos sin Legal formal en V1.5.
- **Riesgo Baileys:** reconocido. Mitigación = staggered onboarding (máx 1 grupo nuevo cada 2-3 días), SIM standby, no bulk-add. Si ban a los 30 días, se acepta como aprendizaje y se migra a WABA oficial para V1.5+.

### 8. Success Metrics V1 (8 semanas)

| Métrica | Target semana 4 | Target semana 8 |
|---|---|---|
| Uptime listener | ≥90% | ≥95% |
| Accuracy Sonnet vs spot-check Santi | ≥80% (50 msgs/sem) | ≥90% (50 msgs/sem) |
| Mensajes procesados <24h | ≥90% | ≥99% |
| Santi abre el Sheet diario | ≥4/7 días | ≥6/7 días |
| Ratio B (incidencias) como señal útil | N/A | Santi confirma que correlaciona con su percepción cualitativa |
| Costo real vs target | ≤$220 | ≤$200 |
| Incidentes de ban | 0 | 0 |

### 9. Open Questions — Resueltas en v1.1

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Baileys vs WABA | Baileys puro, aceptando riesgo de ban |
| 2 | Timeline legal | Piloto solo interno en V1. Legal entra para V1.5 |
| 3 | Scope del piloto | 5-10 grupos 99-internos + cuentas con founder amigo. Consent verbal informal |
| 4 | Ground-truth labeler | Sonnet (modelo más reciente) actúa como ground-truth. Santi spot-check 50 msgs semana 4-5 |
| 5 | Ownership de onboarding | Santi manual vía mini-UI conectada a Supabase |
| 6 | Canal + hora del reporte | Google Sheet auto + link Slack, 9pm CDMX diario |
| 7 | Retención raw | Indefinida en V1 (piloto interno). Política formal en V1.5 |
| 8 | Zonas horarias | Campo `timezone` en tabla `groups`, set manual en onboarding |
| 9 | Modelos Claude | Sonnet (último slug disponible vía env var) para todo el pipeline; sin Haiku |
| 10 | Taxonomía categorías | 21 categorías en 3 buckets (A: 7 positivos, B: 9 incidencias, C: 5 conversacional) |
| 11 | Edits/deletes | Ignorar en V1 |
| 12 | Scope V1 | Ver tabla sección "V1 Plan" |
| 13 | Primer entregable | PRD v1.1 (este doc) → scaffold → T1 → T2 → T3 |

### 10. Open Questions pendientes (bloqueadoras de V1.5, no de V1)

- **OQ-V1.5-1:** Redacción formal de cláusula T&C + aviso de privacidad, sesión con Legal 99.
- **OQ-V1.5-2:** Mecanismo ARCO (derecho al olvido) y purge endpoint.
- **OQ-V1.5-3:** Política de retención real (90d vs 180d para raw; analysis).
- **OQ-V1.5-4:** Criterio de rollout por grupo (quién aprueba qué clientes entran).
- **OQ-V1.5-5:** Heurística vs auditoría para detectar agentes 99 con números personales no registrados.
- **OQ-V2-1:** HubSpot custom properties: Company vs Deal (o ambos).
- **OQ-V2-2:** Alertas fuera de horario: 24/7 vs business hours + excepciones.
- **OQ-V2-3:** Mapa owner→director (reutilizar el del proyecto PHA o crear fresh).
- **OQ-V2-4:** Audio transcription: Whisper local vs OpenAI API.

---

## V1 Plan — 8 semanas

### Scope final

**IN V1:**
| Task | Descripción |
|---|---|
| T0 — Spike técnico | Prototipo de incident reconstruction sobre 500 mensajes reales, semanas 1-2 |
| T1 — Infra base | Supabase Pro + schema 6 tablas + backup config |
| T2 — Listener Baileys | Node.js + PM2 + auth_state backup + healthcheck |
| T3 — Análisis batch | Python + Sonnet + prompt caching + reconstrucción incidents |
| T4 — Reporte diario | Google Sheet auto + Slack link, 9pm CDMX |
| T6 — Calibración | Sonnet-as-ground-truth + spot-check manual + feedback loop simplificado vía Sheet |
| T9 — Onboarding UI | Mini-app Streamlit o Next.js para Santi |

**OUT → V1.5:**
- T5 Looker Studio
- T7 Legal formal + rollout a clientes externos
- Email HTML a directores
- Feedback loop con botones

**OUT → V2:**
- T8 HubSpot sync
- T9 (real-time) Alertas tiempo real
- T10 Scaling 50-100 grupos
- Audio transcription

### Secuencia de ejecución

```
Semana 1: T1 (infra) + T0.1 (spike inicio) + T2.1 (SIM adquisición)
Semana 2: T2 (listener) + T0.2 (spike cierre con conclusión) + primer grupo interno conectado
Semana 3: T3 (análisis batch Sonnet) + T9 (onboarding UI v1) + 3-5 grupos internos activos
Semana 4: T4 (reporte Google Sheet) + T3 (Sonnet resumen) + primer reporte diario entregado
Semana 5: T6 (calibración inicia) + spot-check manual Santi (50 msgs)
Semana 6: Onboarding de cuentas con founder amigo (staggered, 1 cada 2-3 días)
Semana 7: T6 continúa, feedback loop activo vía Sheet. Métricas reales comparadas vs targets.
Semana 8: Hardening, bugfixes, runbook, retrospectiva, plan V1.5 firmado.
```

### Dependencias críticas

1. **T0 spike** bloquea el design final de T3.5. Sin spike, T3 arranca con supuestos no validados.
2. **T2 listener** tiene riesgo de ban. SIM standby adquirido en semana 1, no semana 4.
3. **T3 Sonnet** depende de modelo disponible en API. Si el Sonnet más reciente tiene cambios breaking, fallback a Sonnet 4.5.
4. **T4 Sheet** depende de T3 entregando data válida. Si T3 se retrasa, T4 ejecuta con mocks semana 3 para desbloquear desarrollo del formato.

### Go/No-Go para V1.5

- V1 corriendo 14 días consecutivos con uptime ≥90%.
- Accuracy Sonnet ≥85% sobre 50 msgs/sem de spot-check humano (`RawSample_*`).
- Santi abre el Sheet ≥4/7 días en las últimas 2 semanas.
- 0 incidentes de ban del listener.
- Costo real ≤$220/mes confirmado.
- Santi aprueba subjetivamente que el ratio B/total correlaciona con su percepción del health de los grupos.

### Quick wins por semana

- **Sem 1:** Supabase levantado, schema aplicado, spike arranca.
- **Sem 2:** Listener estable, auth_state backup funcionando, 500+ mensajes ingestados de grupo de prueba.
- **Sem 3:** Primer mensaje clasificado por Sonnet en DB. Onboarding UI deployed localmente.
- **Sem 4:** Primer Google Sheet auto-generado con data real, Slack link recibido por Santi.
- **Sem 5:** Primera tanda de spot-check (50 msgs) documentada vs Sonnet.
- **Sem 6:** 5-7 grupos activos incluyendo 2-3 con founder amigo.
- **Sem 7:** Feedback loop ingiriendo marcas de Santi, few-shot actualizado.
- **Sem 8:** Runbook publicado, retrospectiva, decisión Go/No-Go V1.5.

---

## Appendix A — Schema SQL Inicial v1.1

```sql
-- groups: catálogo de grupos monitoreados
CREATE TABLE groups (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  client_hubspot_id TEXT,
  country TEXT CHECK (country IN ('MX', 'CO', 'CL', 'PE', 'AR', 'OTHER')),
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',  -- v1.1: IANA TZ
  vertical TEXT CHECK (vertical IN ('Envios99', 'Freight99', 'Tailor99', 'Fulfill99', 'Punto99', 'Cross99', 'OTHER')),
  pilot_cohort TEXT CHECK (pilot_cohort IN ('internal', 'founder_friend', 'external')) DEFAULT 'internal',  -- v1.1
  is_active BOOLEAN DEFAULT TRUE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE participants (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  display_name TEXT,
  role TEXT CHECK (role IN ('cliente', 'agente_99', 'otro')) DEFAULT 'otro',
  hubspot_owner_id TEXT,
  hubspot_contact_id TEXT,
  confirmed_by_santi BOOLEAN DEFAULT FALSE,  -- v1.1: gate para saber si el mapeo es manual-verificado
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, phone)
);

CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_msg_id TEXT UNIQUE NOT NULL,
  group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE,
  sender_phone TEXT NOT NULL,
  sender_role TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  content TEXT,
  media_type TEXT,
  reply_to_msg_id TEXT,
  raw_json JSONB,
  analyzed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_group_ts ON messages(group_id, timestamp DESC);
CREATE INDEX idx_messages_analyzed ON messages(analyzed) WHERE analyzed = FALSE;

CREATE TABLE analysis (
  message_id BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  category TEXT NOT NULL,  -- una de las 21, ver Appendix B
  bucket CHAR(1) CHECK (bucket IN ('A','B','C')) NOT NULL,  -- v1.1: bucket derivado
  sentiment NUMERIC(3,2) CHECK (sentiment BETWEEN -1 AND 1),
  urgency TEXT CHECK (urgency IN ('baja', 'media', 'alta')),
  is_incident_open BOOLEAN DEFAULT FALSE,
  is_incident_close BOOLEAN DEFAULT FALSE,
  incident_id BIGINT,
  claude_model TEXT NOT NULL,  -- slug del modelo Sonnet usado (queda registrado por auditabilidad)
  claude_raw JSONB,
  reasoning TEXT,  -- v1.1: explicit para auditabilidad
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_analysis_bucket ON analysis(bucket);
CREATE INDEX idx_analysis_incident ON analysis(incident_id) WHERE incident_id IS NOT NULL;

-- ground_truth_samples: tabla histórica de la era Haiku↔Sonnet (V1 piloto inicial).
-- Se mantiene en el schema para preservar data ya recolectada, pero el pipeline
-- ya NO escribe filas nuevas — todo el batch corre con Sonnet, sin segundo modelo
-- contra el cual comparar. Las columnas haiku_* quedan deprecadas. Ver migration 015.
CREATE TABLE ground_truth_samples (  -- DEPRECATED como destino de escritura (V1.1 → Sonnet-only)
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  sonnet_category TEXT NOT NULL,
  sonnet_sentiment NUMERIC(3,2),
  sonnet_urgency TEXT,
  sonnet_reasoning TEXT,
  haiku_category TEXT,                                                            -- DEPRECATED
  haiku_sentiment NUMERIC(3,2),                                                   -- DEPRECATED
  match_category BOOLEAN,                                                          -- DEPRECATED
  santi_review TEXT CHECK (santi_review IN ('agree_sonnet', 'agree_haiku', 'disagree_both', 'unreviewed')) DEFAULT 'unreviewed',
  santi_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE incidents (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT REFERENCES groups(id),
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  category TEXT,
  urgency TEXT,
  first_response_at TIMESTAMPTZ,
  first_response_by TEXT,
  resolution_at TIMESTAMPTZ,
  sentiment_start NUMERIC(3,2),
  sentiment_end NUMERIC(3,2),
  sentiment_avg NUMERIC(3,2),
  owner_phone TEXT,
  summary TEXT,
  message_count INT,
  ttfr_seconds INT,
  ttr_seconds INT,
  timezone TEXT,  -- v1.1: copiado de groups para snapshot histórico
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_incidents_group_opened ON incidents(group_id, opened_at DESC);
CREATE INDEX idx_incidents_open ON incidents(closed_at) WHERE closed_at IS NULL;

CREATE TABLE classification_feedback (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES messages(id),  -- v1.1: granularidad a mensaje, no solo incident
  incident_id BIGINT REFERENCES incidents(id),
  feedback_type TEXT CHECK (feedback_type IN ('thumbs_up', 'thumbs_down', 'recat')),
  suggested_category TEXT,  -- v1.1: si Santi propone otra categoría
  feedback_note TEXT,
  reviewer_email TEXT DEFAULT 'santi@99minutos.com',
  reviewed_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Appendix B — Taxonomía de 21 categorías (V1)

### Bucket A — Eventos operativos positivos (7)

| # | Código | Descripción |
|---|---|---|
| 1 | `presentacion_unidad` | Unidad se presenta al punto de origen/destino |
| 2 | `presentacion_chofer` | Chofer se presenta |
| 3 | `presentacion_auxiliar` | Auxiliar se presenta |
| 4 | `confirmacion_llegada` | Llegada exitosa a destino/cliente |
| 5 | `confirmacion_salida` | Salida exitosa del punto/origen |
| 6 | `reporte_entrega` | Entrega exitosa al destinatario final |
| 7 | `confirmacion_evidencias` | Envío/recepción de fotos, firma, POD |

### Bucket B — Incidencias operativas (9)

| # | Código | Descripción |
|---|---|---|
| 8 | `problema_unidad` | Issue con la unidad/vehículo (mecánico, disponibilidad, asignación) |
| 9 | `problema_horario` | Horarios/timing (atrasos, reprogramaciones) |
| 10 | `problema_entrada` | Issue en entrada al punto (CEDIS, cliente, etc.) |
| 11 | `problema_salida` | Issue en salida de la unidad |
| 12 | `problema_trafico` | Tráfico |
| 13 | `problema_manifestacion` | Bloqueos, manifestaciones, vías cerradas |
| 14 | `robo_incidencia` | Robo o incidencia de seguridad |
| 15 | `problema_sistema` | Plataforma, app, tech, integraciones |
| 16 | `problema_proveedor` | Issue con otro proveedor externo (gasolinera, carga, cliente final) |

### Bucket C — Conversacional / meta (5)

| # | Código | Descripción |
|---|---|---|
| 17 | `acuse_recibo` | Ack del agente ("copiado", "enterado", "va") — **dispara TTFR sin cerrar incidencia** |
| 18 | `confirmacion_resolucion` | Cierre de incidencia ("resuelto", "listo", "recibido conforme") |
| 19 | `consulta_info` | Pregunta neutral sin queja |
| 20 | `saludo_ruido` | Buenos días, stickers, audios sin contexto claro, gracias aislado |
| 21 | `otro` | Fallback |

### Métrica derivada

**Ratio B = count(bucket='B') / count(bucket IN ('A','B','C'))** por grupo por día.
Rangos esperados:
- <10%: grupo saludable
- 10-25%: grupo en operación normal con fricción esperable
- >25%: grupo estresado, requiere atención
- >40%: alerta

---

## Appendix C — Prompt de Clasificación v1.1 (Borrador)

```
SYSTEM (CACHED 5min+):
You are an ops analyst for 99minutos, a LATAM last-mile logistics company.
Classify WhatsApp messages from client ops groups into one of 21 categories,
grouped in 3 buckets (A: positive ops events, B: incidents, C: conversational).

Return ONLY valid JSON:
{
  "category": "<one of the 21 codes>",
  "bucket": "A" | "B" | "C",
  "sentiment": float between -1.0 and 1.0,
  "urgency": "baja" | "media" | "alta",
  "is_incident_open": boolean,
  "is_incident_close": boolean,
  "reasoning": "max 20 words Spanish"
}

RULES:
- Bucket A codes: presentacion_unidad, presentacion_chofer, presentacion_auxiliar,
  confirmacion_llegada, confirmacion_salida, reporte_entrega, confirmacion_evidencias.
- Bucket B codes: problema_unidad, problema_horario, problema_entrada, problema_salida,
  problema_trafico, problema_manifestacion, robo_incidencia, problema_sistema, problema_proveedor.
- Bucket C codes: acuse_recibo, confirmacion_resolucion, consulta_info, saludo_ruido, otro.
- Only 'cliente' messages can set is_incident_open=true.
- 'agente_99' messages with category=acuse_recibo do NOT close incidents.
- confirmacion_resolucion closes incidents.
- Messages in Spanish (MX/LATAM). Preserve regional slang understanding.

USER (NON-CACHED, rotates):
[FEW-SHOT EXAMPLES — updated weekly from feedback loop, 10-20 examples max]

Group: {group_name}
Group country: {country}
Group timezone: {timezone}
Sender role: {sender_role}
Sender phone last 4: {phone_last4}
Timestamp: {timestamp}
Previous 3 messages (context):
{context_messages}

Message to classify:
"{message_content}"
```

---

## Appendix D — Budget Estimado V1 (5-10 grupos, ~30K msg/mes)

| Item | Costo mensual USD | Notas |
|---|---|---|
| Supabase Pro | $25 | Plan base |
| Claude Sonnet (clasificación + análisis + resúmenes) | $140-180 | 30K msg × ~1.5K tokens input cached 80%; reemplaza el approach Haiku+Sonnet original. |
| SIM prepago MX | $10 | Recarga mensual |
| SIM standby | $5 | Recarga mínima para mantener activo |
| Mac Mini compute | $0 | Existente |
| Google Sheets / Slack | $0 | Workspace existente |
| **Total V1** | **$180-220** | Sonnet-only sube el costo respecto al PRD original ($65-80) pero simplifica el pipeline a un solo modelo y mejora accuracy operacional. |

A escala de 50 grupos (V2), extrapolación: $400-650/mes. Se revisa el target en V2 — opciones: prompt caching más agresivo, batch API, o reintroducir Haiku como pre-filtro si el delta de accuracy lo justifica.

---

## Appendix E — Riesgos y Mitigaciones v1.1

| Riesgo | Prob | Impacto | Mitigación |
|---|---|---|---|
| Ban del número Baileys | Media-Alta | Alto | SIM standby + staggered onboarding + no bulk-add; aceptado explícitamente |
| Spike revela incident reconstruction inviable con batch | Media | Alto | Fallback: reportar por mensaje/día sin agrupar en incidentes en V1 |
| Sonnet sesgado por categoría | Media | Medio | Spot-check manual Santi semanal sobre `RawSample_*` (50 msgs) + ajustar few-shot examples |
| Accuracy Sonnet vs spot-check humano <85% a 30d | Media | Medio | Extender piloto 2 semanas, refinar few-shot, evaluar prompt caching más agresivo |
| Mac Mini se satura | Baja | Medio | Plan B Hetzner documentado en runbook, no ejecutado V1 |
| Baileys breaking change | Media | Medio | Versionar dependencia, subscribe a releases Github |
| Agente 99 con número personal contamina data | Alta | Medio | Auditoría semanal vía UI de onboarding, flag manual |
| Google Sheets API rate limit | Baja | Bajo | Una escritura batch por día, muy por debajo del límite |
| Costo excede $220/mes | Media | Bajo | Cap en Anthropic Console + monitor semanal; considerar batch API o cache TTL extendido |

---

## Appendix F — Definiciones Operativas

- **TTFR:** segundos desde mensaje con `is_incident_open=true` de un `cliente` hasta primer mensaje con categoría `acuse_recibo` o `confirmacion_resolucion` o cualquier Bucket B de un `agente_99` en el mismo grupo, respetando timezone del grupo.
- **TTR:** segundos desde apertura de incidencia hasta `confirmacion_resolucion` del cliente o agente.
- **Incidente:** serie de mensajes con (a) mismo grupo, (b) ventana temporal ≤72h entre mensajes consecutivos del hilo, (c) apertura con `is_incident_open=true`, (d) cierre con `confirmacion_resolucion` o timeout 72h.
- **Sentiment score del grupo:** promedio ponderado por recencia de sentiments de mensajes `cliente` en últimos 30 días.
- **Ratio B:** count(bucket='B') / count(bucket IN ('A','B','C')) en ventana definida.
- **Zona roja TTFR (V1):** TTFR promedio semanal del agente >30 min dentro de business hours (9am-8pm en TZ del grupo).
- **Accuracy Sonnet:** % de mensajes del `RawSample_*` semanal donde el spot-check humano (Santi) marca la categoría como correcta.

---

## Decisions Log — v1 → v1.1

| # | Área | v1 decía | v1.1 decide | Impacto |
|---|---|---|---|---|
| 1 | Transport | Baileys | Baileys (confirmado, riesgo aceptado) | — |
| 2 | Legal | T7.1 sem 5 | V1 solo interno, Legal en V1.5 | -3 semanas riesgo |
| 3 | Rollout | 20 grupos externos | 5-10 grupos internos + founder-friends | -50% riesgo legal, -75% riesgo ban |
| 4 | Accuracy | 85% vs validación humana | Sonnet-only + spot-check semanal Santi sobre `RawSample_*` (50 msgs) | Validación humana directa, sin segundo modelo de comparación |
| 5 | Reporte | Email HTML 6:30am + Slack | Google Sheet 9pm + Slack link | -60% esfuerzo T4 |
| 6 | Dashboard | Looker Studio V1 | OUT V1, eval V1.5 | -1 semana T5 |
| 7 | HubSpot sync | V2 | V2 confirmado | — |
| 8 | Alertas RT | V2 | V2 confirmado | — |
| 9 | Retención | 90d / indefinida | Indefinida V1 (interno) | Sin bloqueador legal |
| 10 | Timezones | No definido | Campo TZ por grupo | +1 columna schema |
| 11 | Modelos | Haiku 4.5 + Sonnet 4.6 | Sonnet único (slug último vía env var); Haiku descontinuado del pipeline | Simplifica ops, sube costo, mejora accuracy operacional |
| 12 | Categorías | 7 genéricas | 21 en 3 buckets (ops-específicas) | Taxonomía alineada a operación real |
| 13 | Edits/deletes | No mencionado | Ignorados V1 | Schema simplificado |
| 14 | Incident reconstruction | T3.5 viñeta | T0 spike obligatorio semanas 1-2 | -riesgo de sorpresa semana 6 |
| 15 | Onboarding UI | No mencionado | Mini-app Streamlit/Next.js | +1 task, alto valor |
| 16 | auth_state backup | No mencionado | Sync a Supabase Storage cada 1h | +DR capability |
| 17 | Bucket metrics | No mencionado | Ratio B/total como header metric | KPI primario del reporte |

---

**Fin del documento. v1.1 listo para ejecución.**
