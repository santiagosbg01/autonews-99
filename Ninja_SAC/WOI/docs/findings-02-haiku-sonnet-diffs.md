# Findings-02: Haiku↔Sonnet Diffs — Análisis de clasificación en producción
**Sesión:** 2  
**Fecha:** 2026-04-27  
**Corpus:** 3,533 mensajes clasificados desde 2026-04-24 al 2026-04-27  
**ground_truth_samples disponibles:** 2 (0 disagreements útiles)  

> **NOTA HISTÓRICA (abril 2026):** este documento corresponde al período en
> que el pipeline aún tenía el approach dual Haiku+Sonnet con muestreo
> ground-truth. Posteriormente se migró a **Sonnet-only** (ver migration 015 y
> sección 9 del PRD). Los hallazgos se conservan para referencia, pero las
> métricas de consistencia Haiku↔Sonnet ya no se calculan ni se llenan en
> producción. La accuracy se mide ahora vía spot-check humano semanal sobre
> el tab `RawSample_*` del Google Sheet.

---

## 0. Contexto: Sonnet es el modelo de producción (intencional)

`ground_truth_samples` tiene 2 registros porque la comparación Haiku↔Sonnet nunca fue
activada — y según decisión de diseño actualizada, **Sonnet es y debe ser el modelo de
producción** para clasificación. El `use_sonnet=True` en `classifier.py:51` es correcto.

Esto tiene dos consecuencias para esta sesión:
- No hay disagreements Haiku↔Sonnet que analizar.
- El uso futuro de `ground_truth_samples` está pendiente de definición (ver §4, P3).

El análisis de esta sesión se enfoca en errores estructurales que Sonnet comete contra
sus propias reglas de prompt — útiles independientemente del modelo.

---

## 1. Errores estructurales encontrados en producción (Sonnet)

Sin datos de Haiku, se analizaron las 3,533 clasificaciones de Sonnet contra las reglas
del system prompt.

### 1a. `is_incident_close=true` con category ≠ `confirmacion_resolucion` — 20 casos

**Regla del prompt:** `is_incident_close=true` solo si category = `confirmacion_resolucion`.

**Realidad encontrada:** Sonnet pone is_incident_close=true en categorías Bucket A cuando
lee contextualmente que el evento "cierra" el hilo de un problema previo:

| Category violadora | N | Ejemplos reales |
|---|---|---|
| `confirmacion_llegada` | 7 | "ya esta entrando señor", "Ya ingreso", "ya contamos con almacenero" |
| `confirmacion_salida` | 8 | "La UT de Lurin ya salió", "Ya puede acercarse el operador", "Todo en ruta de 9:00" |
| `reporte_entrega` | 5 | "Buenas tardes ese pedido ya fue entregado", "la unidad ya culminó descarga", "entregado ok" |

**Razonamiento de Sonnet (literal):** "Agente confirma entrega exitosa tras incidente previo
de acceso bloqueado" / "Confirman llegada de almacenero pendiente, resolviendo la ausencia
señalada" — el modelo está haciendo razonamiento contextual correcto operacionalmente, pero
viola la regla de schema.

**Causa contribuyente: Example 7 del few_shot_examples.md actual** muestra
`confirmacion_evidencias` + `is_incident_close=true` con la nota "el modelo debe priorizar la
categoría por el contenido pero marcar el close". Esto enseña al modelo a generalizar el
patrón a cualquier Bucket A que "resuelva" algo.

**Tipo de fix:** Regla de prompt + few-shots correctivos (ver §4 y el archivo .proposed).

**No confundir con:** El reconstructor tiene `STRONG_CLOSE_CATEGORIES` que incluye
`confirmacion_resolucion`, `confirmacion_salida`, `confirmacion_evidencias`. Eso está bien
diseñado y es independiente del flag `is_incident_close` que controla el prompt. El flag
es para el reconstructor V2+ cuando se abandone la heurística de categorías. Por ahora la
consistencia del flag importa para auditoría futura.

---

### 1b. `is_incident_open=true` con `sender_role='otro'` — 207 casos (todos Bucket B)

**Regla del prompt:** "Solo mensajes de `cliente` pueden tener `is_incident_open=true`."

**Realidad:** 207 incidentes reales abiertos por senders con role='otro'. Ejemplos:
- "Pedido no se factura ya que el cliente desea que se pase si o si de los 500 soles, cliente
  critico" (otro, grupo Perú, urgencia alta)
- "Conductor inconsciente, esta quebrantado de salud" (otro, urgencia alta)
- "SML-978 Buenas tardes, esta placa esta llegando a barranquilla con devoluciones sin
  codigo, no me contesta" (otro)

**Causa raíz:** 83% de todos los mensajes son de role='otro' (2,939 / 3,533). El onboarding
de roles está prácticamente sin completar. Los "otros" incluyen operadores de campo,
monitoristas, coordinadores del cliente, y choferes — todos capaces de reportar incidentes.

**Evaluación:** Sonnet está haciendo lo correcto contextualmente. La regla del prompt es
demasiado estricta para la realidad del piloto. Los 207 casos son incidentes reales, no
falsos positivos.

**Fix recomendado:** Actualizar la regla del system prompt (no el few-shot):
```
# Actual
Solo mensajes de 'cliente' pueden tener is_incident_open=true.

# Propuesto
Solo mensajes de rol 'cliente' u 'otro' pueden abrir incidencias.
Los mensajes de 'agente_99' NUNCA abren incidencias, aunque describan un problema.
```

---

### 1c. `is_incident_open=true` en Bucket C — 2 casos (`consulta_info`)

Ambos del mismo grupo, mismo timestamp:
- "Alguna respuesta?" (cliente, urgencia alta, sentiment -0.6)
- "@175136200224873 @98093311758556" (cliente, urgencia alta, sentiment -0.4)

Son un cliente escalando sin respuesta previa. `consulta_info` no es la categoría correcta —
debería ser Bucket B (`problema_horario` o similar) si hay contexto de problema, o mantenerse
en `consulta_info` con `is_incident_open=false`. La combinación `consulta_info + is_incident_open=true`
es semánticamente contradictoria (bucket C no puede abrir incidencias).

**Fix:** Few-shot de escalación sin respuesta (ver .proposed, Example 14).

---

## 2. Anomalía de distribución: `consulta_info` al 31.6%

La distribución de categorías en producción muestra un problema sistémico:

| Categoría | % | Esperado |
|---|---|---|
| `consulta_info` | 31.6% | ~5-8% |
| `otro` | 18.2% | ~10% |
| Total Bucket C | 72.5% | ~35-40% |
| Total Bucket B | 12.1% | ~20-30% |

`consulta_info` y `otro` acaparan mensajes que deberían caer en categorías más específicas.
El 81% de los `consulta_info` son de sender_role='otro' — el modelo usa esta categoría como
catch-all para cualquier mensaje de "otro" que no encaje limpiamente.

**Mensajes que se clasifican como `consulta_info` y no deberían:**

| Mensaje real (otro) | Debería ser |
|---|---|
| Plantilla MONITORISTA: "Omega 11 / UNIDAD: 37BA6M / OBSERVACIONES: unidad sale a ruta" | `confirmacion_salida` o `presentacion_unidad` |
| "@tag @tag @tag me apoyan a que se presenta a su ventana" | `problema_entrada` (Bucket B) |
| "compañeros @271... @57... confirmadas las placas para TIENDAS y NODOS" | `confirmacion_salida` |
| "Buen día equipo, ambas fueron recogidas y ya se encuentran en camino" | `confirmacion_salida` |
| Listas con guías/pedidos sin novedad aparente | `consulta_info` o `otro` (correcto) |

**La regla faltante:** Cuando un mensaje de 'otro' describe acción operativa completada
(salida, entrega, llegada), aplica la misma categoría Bucket A que si fuera 'agente_99'.
El rol del sender no cambia la categoría del evento.

---

## 3. Sentiment / urgency drift (Sonnet vs sí mismo)

Sin Haiku para comparar, se calculó la distribución interna de Sonnet como baseline:

| Categoría | Avg sentiment | Rango esperado |
|---|---|---|
| `robo_incidencia` | -0.76 | -0.7 a -1.0 ✓ |
| `problema_unidad` | -0.48 | -0.3 a -0.7 ✓ |
| `problema_horario` | -0.42 | -0.3 a -0.6 ✓ |
| `confirmacion_salida` | +0.22 | +0.1 a +0.5 ✓ |
| `consulta_info` | -0.04 | ~0.0 ✓ |
| `acuse_recibo` | +0.18 | 0.0 a +0.3 ✓ |

Sentiment parece bien calibrado. Sin Haiku, el drift no se puede medir directamente.

**Urgency:** `robo_incidencia` 100% urgencia alta (correcto). `problema_horario` 21% alta
(13/150) — razonable dado que el sistema prompt dice "alta" para "ya, ahorita, bloqueo total".
`consulta_info` 1.3% alta (14 msgs) — sugiere que esos 14 deberían probablemente ser Bucket B.

---

## 4. Recomendaciones priorizadas

### P1 — Reglas del system prompt (`classification_system.md`)

2. **Regla is_incident_open:** Agregar 'otro' como rol que puede abrir incidencias.
3. **Regla is_incident_close:** Aclarar que SOLO `confirmacion_resolucion` o
   `confirmacion_evidencias` (cuando es POD explícito de cierre) ponen is_incident_close=true.
   Los demás Bucket A (llegada, salida, entrega) NO cierran el flag aunque contextualmente
   resuelvan el hilo.
4. **Regla `consulta_info`:** Agregar discriminador: "Si el mensaje de 'otro' describe una
   acción operativa completada, usar la categoría Bucket A o B correspondiente. `consulta_info`
   es para preguntas genuinamente neutrales sin contenido de problema ni evento positivo."

### P2 — Few-shots nuevos (ver `few_shot_examples.md.proposed`)

5. Monitorista/relay → Bucket A correcto (ataca inflación de `consulta_info`)
6. Plantilla "Alertas entrega 🚨" → Bucket B correcto (ataca `otro` + is_incident_open)
7. Bucket A + resolución contextual → is_incident_close=false (ataca error 1a)
8. Escalación "Alguna respuesta?" → Bucket B, no consulta_info (ataca error 1c)
9. Otro abre incidente real → is_incident_open=true válido
10. @mention-only → `saludo_ruido` o `consulta_info`, no incidente

### P3 — Definir uso de `ground_truth_samples` (pendiente decisión)

Con Sonnet como modelo único de producción, la tabla necesita un nuevo propósito.
Opciones: (A) Sonnet con extended reasoning vs producción para detectar inestabilidad en
casos ambiguos, (B) scrappear la tabla y hacer el feedback loop solo via spot-check manual
de Santi en el Sheet, (C) usarla como snapshot histórico para comparar versiones futuras
de Sonnet. Pendiente decisión antes de implementar.

---

## Apéndice: tablas consultadas

`analysis`, `vw_messages_claude`, `ground_truth_samples`, `information_schema.tables`,
`information_schema.columns`
