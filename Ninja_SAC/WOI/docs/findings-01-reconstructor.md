# Findings-01: Auditoría del Incident Reconstructor
**Sesión:** 1 — Auditoría incident_reconstructor.py  
**Fecha:** 2026-04-27  
**Sample:** 50 incidentes cerrados (más recientes) + 30 stale (últimos 30 días) = 80 total, 635 mensajes  
**DB:** 247 incidentes totales, 148 cerrados, 99 abiertos/stale  

> **NOTA HISTÓRICA (abril 2026):** este documento se redactó cuando el pipeline
> usaba Haiku 4.5 para clasificación masiva. Poco después se migró a
> **Sonnet-only** (ver migration 015 y sección 9 del PRD). Las métricas de
> "Haiku miss rate" siguen siendo válidas como diagnóstico histórico del
> reconstructor — el comportamiento del módulo es independiente del modelo
> que generó los flags `is_incident_open` / `is_incident_close`.

---

## 1. Métricas principales

| Métrica | Valor | Nota |
|---|---|---|
| **Tasa de cierre oculto (Haiku miss rate)** | 4% (2/50) | Solo emoji-solo; 0% lexical miss |
| **Inconsistencia categoría/flag** | 0% (0/50) | Cuando clasifica `confirmacion_resolucion`, siempre pone `is_incident_close=true` |
| **Mensajes "potencialmente misatribuidos" (sample 80)** | 54% (343/635) | Ver §3b — el número está inflado por "otro" (83% de msgs) |
| **Grupos con >1 incidente abierto simultáneo** | 11 grupos | Max 34 open a la vez, avg 8.6 — bug activo en esos grupos |
| **Stale "resueltos sin marca"** | 20% (6/30) | 3 con respuesta de agente + señal cierre; 3 sin respuesta de agente |
| **Stale "en curso"** | 80% (24/30) | Todos de hoy, ninguno con respuesta de agente |

### Distribución de resolution_source (50 cerrados)

| Fuente | N | % | TTR avg | TTFR avg | Msgs avg |
|---|---|---|---|---|---|
| `customer_signal` | 33 | 66% | 0.5 h | 3.5 min | 9.2 |
| `eod_unresolved` | 8 | 16% | — | 836 min (14 h) | 4.6 |
| `eod_resolved` | 4 | 8% | — | — | 9.0 |
| `inactivity` | 2 | 4% | — | 50 min | 10.0 |
| `agent_signal` | 2 | 4% | 0.1 h | 2.7 min | 8.5 |
| `sonnet_thread` | 1 | 2% | 1.9 h | — | 19.0 |

---

## 2. Cierres ocultos (Haiku miss rate)

### 2.1 Resultado

- **2 de 50 incidentes** tienen mensajes de cierre con `is_incident_close=false` que el reconstructor no detectó vía flag.
- **Ambos son emoji-solo** (👍 de sender_role='otro' o 'cliente'), clasificados por Haiku como `acuse_recibo` en lugar de `confirmacion_resolucion`.
- **0 falsos negativos léxicos**: ningún "ya quedó", "perfecto", "recibido", etc. fue ignorado.
- **0 inconsistencias categoría/flag**: cuando Haiku asigna `confirmacion_resolucion`, siempre activa `is_incident_close=true`.

### 2.2 Análisis

El 4% es un número bajo y el reconstructor cubre el gap mediante mecanismos de respaldo (Sonnet pass, inactivity, EOD). El problema real no es la tasa de miss sino la **ambigüedad del 👍 de rol "otro"**: Haiku no puede distinguir entre:

- `👍` como ack ("entendido, vamos viendo") → `acuse_recibo` correcto
- `👍` como cierre implícito ("recibido, ya quedamos") → debería ser `confirmacion_resolucion`

La distinción es **contextual** y requiere los mensajes previos. Haiku la resuelve bien en texto pero pierde el contexto cuando el mensaje es solo emoji.

### 2.3 Patrones de cierre oculto para few-shot examples

Mensajes reales encontrados con señal de cierre no detectada:

```
# Caso 1 — emoji solo de 'otro' mid-incident
sender: otro | content: "👍" | category: acuse_recibo | is_incident_close: false
→ Haiku correcto si es ack; incorrecto si es el último mensaje del hilo y el incidente queda estático

# Caso 2 — emoji solo de 'cliente' al final del hilo
sender: cliente | content: "👍" | category: acuse_recibo | is_incident_close: false
→ Si no hay mensajes posteriores del cliente en >4h → cierre implícito probable

# Caso 3 — "listo si señorita" de 'otro' 
sender: otro | content: "listo si señorita" | category: acuse_recibo | is_incident_close: false
→ Debería ser confirmacion_resolucion si el hilo tenía un problema previo resuelto
```

**Recomendación para few-shot**: agregar ejemplos donde emoji + posición final del hilo = `confirmacion_resolucion`. No cambiar el prompt para todos los 👍 (generaría falsos positivos). Agregar 2-3 ejemplos con contexto de mensajes previos que hacen al 👍 un cierre.

---

## 3. Bug del reconstructor — Misatribución de mensajes

### 3.1 El bug (línea ~175, `_reconstruct_group`)

```python
# Código actual — bug
if open_incidents:
    most_recent_owner = max(open_incidents.keys(), key=lambda o: open_incidents[o].opened_at)
    inc = open_incidents[most_recent_owner]
    inc.message_ids.append(m["id"])
```

Cualquier mensaje que no sea `is_incident_open` se adjunta al incidente **más reciente del grupo**, sin verificar si el sender tiene su propio incidente abierto o si pertenece a otro hilo.

### 3.2 Métricas

- **635 mensajes** en los 80 incidentes del sample
- **343 (54%) potencialmente misatribuidos** — pero este número está inflado
- **Factor inflacionario**: 83% de todos los mensajes en la DB son de rol `otro` (participantes sin asignar en onboarding). El check `sender_phone != owner_phone` es casi siempre verdadero para "otro", independientemente de si el mensaje pertenece al incidente.
- **Exposición real del bug**: **11 grupos** tienen >1 incidente abierto simultáneamente. En esos grupos hay **95 incidentes activos** y **502 mensajes** — aquí el bug sí confunde hilos entre clientes diferentes.
- El grupo más afectado tiene **34 incidentes abiertos al mismo tiempo** — prácticamente toda la actividad del grupo se vuelca al incidente más reciente.

### 3.3 Condición que activa el bug

El bug solo causa daño observable cuando:
1. Dos o más clientes distintos tienen incidentes abiertos en el mismo grupo
2. Un mensaje de Cliente B llega mientras el incidente más reciente es de Cliente A
3. Ese mensaje se asigna al incidente de Cliente A, contaminando su hilo

Con la asignación de roles actual (83% "otro"), **no podemos cuantificar con precisión qué porcentaje de los 343 son cross-client vs mismo-cliente-equipo**. La métrica honesta es: el bug existe y está activo en al menos 11 grupos.

### 3.4 Diff propuesto para `incident_reconstructor.py`

```diff
--- a/woi-analyzer/src/woi_analyzer/incident_reconstructor.py
+++ b/woi-analyzer/src/woi_analyzer/incident_reconstructor.py
@@ -174,7 +174,10 @@ def _reconstruct_group(group_id: int, since: datetime) -> list[IncidentCandidate]:
         # Para cualquier otro mensaje, si hay incidentes abiertos en el grupo,
-        # lo adjuntamos al más reciente (heurística simple V1).
+        # preferimos el incidente del mismo sender; si no tiene uno abierto,
+        # caemos al más reciente del grupo (heurística de respaldo).
         if open_incidents:
-            # Elegimos el incidente más reciente abierto en el grupo (no por owner)
-            most_recent_owner = max(open_incidents.keys(), key=lambda o: open_incidents[o].opened_at)
+            if m["sender_phone"] in open_incidents:
+                most_recent_owner = m["sender_phone"]
+            else:
+                most_recent_owner = max(open_incidents.keys(), key=lambda o: open_incidents[o].opened_at)
             inc = open_incidents[most_recent_owner]
             inc.message_ids.append(m["id"])
```

**Efecto**: cuando un cliente que tiene su propio incidente abierto envía mensajes, estos se adjuntan a su propio hilo en lugar del hilo más reciente del grupo. Costo: 0 lógica adicional, 1 dict lookup. Riesgo: mínimo — solo cambia comportamiento cuando el sender tiene un incidente propio abierto.

**Limitación que permanece**: mensajes de "otro" (rol no asignado) siguen yendo al incidente más reciente. Esto no se puede resolver hasta que el onboarding asigne roles a los participantes.

---

## 4. Stale = ¿abandonado o resuelto sin marca?

### 4.1 Resultado

Los 30 stale del sample son **todos de hoy (2026-04-27)**, abiertos en las últimas 7 horas:

| Clasificación | N | Urgencia alta | Sin respuesta agente |
|---|---|---|---|
| **en_curso** | 24 | 7 | 24 (100%) |
| **resuelto_sin_marca** | 3 | 0 | 0 |
| **resuelto_sin_marca_sin_respuesta** | 3 | 1 | 3 (100%) |

- **0 abandonados** (ninguno con >48h de inactividad sin respuesta)
- **0 timeout_candidatos** (ninguno >72h abierto)

### 4.2 Hallazgo crítico operacional

**Los 24 "en_curso" tienen 0 respuestas de agente** a pesar de llevar entre 0.2h y 6.9h abiertos. Muchos ya fueron auto-escalados. Esto no es un bug del reconstructor — el reconstructor los detecta correctamente como abiertos/escalados. El problema es **ausencia de pickup por parte de los agentes**.

El reconstructor no puede cerrar por inactividad estos tickets porque `INACTIVITY_RESOLVE_HOURS` solo aplica cuando `first_response_at IS NOT NULL`. Diseño correcto: no auto-cerrar un incidente que nunca fue atendido.

### 4.3 Anomalía: sonnet_thread con closed_at NULL

4 incidentes stale tienen `resolution_source='sonnet_thread'` pero `closed_at IS NULL`. Esto sugiere una race condition: el Sonnet pass marca la fuente pero el `reconstruct_recent_incidents` posterior reconstruye el incidente y lo vuelve a dejar abierto (sobrescribe sin respetar el closed_at ya seteado). Requiere investigación separada.

### 4.4 Resueltos sin marca (6/30 = 20%)

- **3 con respuesta de agente**: tienen señal de cierre (👍, "listo", "recibido") Y `first_response_at` seteado. El Sonnet pass debería haber capturado estos en su próximo ciclo.
- **3 sin respuesta de agente**: tienen señal de cierre pero `first_response_at IS NULL`. El reconstructor no puede cerrarlos por inactivity (requiere respuesta previa). Quedan como falsos positivos de incidente abierto.

---

## 5. Recomendación: mantener / mejorar / reemplazar

**Veredicto: MEJORAR — no reemplazar.**

### Justificación

El reconstructor heurístico V1 funciona:
- **66% de los cierres son `customer_signal`** — el sistema detecta correctamente el 96% de cierres donde hay señal textual clara
- **TTR real de 0.5h** para los incidentes que cierran normalmente — mucho mejor que lo esperado
- **0% inconsistencias categoría/flag** — la integración Haiku→reconstructor es limpia
- **La tasa de miss de cierres (4%)** es baja y cubierta por los mecanismos de respaldo (Sonnet, inactivity, EOD)

### Dos fixes inmediatos de alto impacto

**Fix 1 (línea ~175)** — sender-preference en message attachment. Cambio de 3 líneas, reduce contaminación de hilos en los 11 grupos con multi-open. Ver §3.4.

**Fix 2 (prompt de clasificación)** — agregar 2-3 few-shot examples con emoji-como-cierre en contexto de resolución previa. Reduce el 4% de miss a ~1-2%. Ver §2.3.

### Lo que NO requiere cambio ahora

- El timeout de 72h es razonable para ops de logística
- `STRONG_CLOSE_CATEGORIES` / `WEAK_CLOSE_CATEGORIES` están bien calibradas
- El Sonnet pass (`_sonnet_resolution_pass`) funciona como red de seguridad efectiva
- La lógica de `eod_unresolved` / `eod_resolved` cubre los gaps que quedan

### Camino a V1.5

1. **Onboarding de roles pendiente**: el 83% de mensajes en "otro" es el mayor bloqueador para medir misatribución real y para que el reconstructor pueda hacer sender-matching más fino.
2. **Anomalía sonnet_thread + closed_at NULL**: investigar race condition entre `reconstruct_recent_incidents` y `refresh_open_ticket_statuses`. Posible fix: en `_upsert_incidents`, hacer `COALESCE(closed_at, %s)` para no pisar un closed_at ya seteado.
3. **24 incidentes escalados sin respuesta de agente**: señal operacional real. Considerar segundo-nivel de alerta cuando un incidente lleva >1h en estado `escalado` sin `first_response_at`.

---

## Apéndice: tablas/vistas consultadas

`incidents`, `analysis`, `vw_messages_claude`, `information_schema.tables`, `information_schema.columns`
