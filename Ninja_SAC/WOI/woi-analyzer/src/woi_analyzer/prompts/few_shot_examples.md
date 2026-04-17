# Few-shot examples (V1 initial seed)

Este archivo se actualiza semanalmente con los thumbs up/down que Santi marca en el Google Sheet.
La sección User del prompt incluye estos ejemplos en un bloque NO cacheable (el system sí es cacheable),
para que rotar ejemplos no invalide el cache de Anthropic.

---

## Example 1

Group: CDMX Ops - Cliente ACME
Sender role: cliente
Timestamp: 2026-04-15T09:12:00-06:00
Previous context:
[agente_99] Buenos días, reportando inicio de ruta 7am.

Message to classify:
"La unidad no ha llegado y llevo esperando desde las 8. Por favor rastreen."

Expected JSON:
```json
{
  "category": "problema_horario",
  "bucket": "B",
  "sentiment": -0.5,
  "urgency": "media",
  "is_incident_open": true,
  "is_incident_close": false,
  "reasoning": "Cliente reporta atraso de la unidad con frustración moderada."
}
```

---

## Example 2

Group: GDL Freight - Fulfill99
Sender role: agente_99
Timestamp: 2026-04-15T10:30:00-06:00
Previous context:
[cliente] Falta la unidad
[agente_99] Buenos días

Message to classify:
"Copiado, verificando con dispatch, regreso en 5 min."

Expected JSON:
```json
{
  "category": "acuse_recibo",
  "bucket": "C",
  "sentiment": 0.0,
  "urgency": "baja",
  "is_incident_open": false,
  "is_incident_close": false,
  "reasoning": "Agente acusa recibo y promete follow-up. Dispara TTFR."
}
```

---

## Example 3

Group: Monterrey CEDIS
Sender role: cliente
Timestamp: 2026-04-15T14:05:00-06:00
Previous context:
[agente_99] ¿Pudieron cargar la unidad?
[cliente] Sí, todo ok.
[agente_99] ¿Recibieron bien?

Message to classify:
"Listo, todo perfecto. Gracias!"

Expected JSON:
```json
{
  "category": "confirmacion_resolucion",
  "bucket": "C",
  "sentiment": 0.6,
  "urgency": "baja",
  "is_incident_open": false,
  "is_incident_close": true,
  "reasoning": "Cliente confirma cierre exitoso del tema con agradecimiento."
}
```

---

## Example 4

Group: Bogotá Last Mile
Sender role: agente_99
Timestamp: 2026-04-15T11:45:00-05:00
Previous context:
(sin contexto previo relevante)

Message to classify:
"Unidad 1247 se presenta en punto de recolección CEDIS norte."

Expected JSON:
```json
{
  "category": "presentacion_unidad",
  "bucket": "A",
  "sentiment": 0.0,
  "urgency": "baja",
  "is_incident_open": false,
  "is_incident_close": false,
  "reasoning": "Reporte positivo de presentación de unidad en punto."
}
```

---

## Example 5

Group: CDMX Ops - ACME
Sender role: cliente
Timestamp: 2026-04-15T16:20:00-06:00
Previous context:
[agente_99] Reportando estado ruta.

Message to classify:
"Nos acaban de asaltar al chofer en el trayecto, se llevaron la mercancía. Necesitamos acción URGENTE."

Expected JSON:
```json
{
  "category": "robo_incidencia",
  "bucket": "B",
  "sentiment": -0.9,
  "urgency": "alta",
  "is_incident_open": true,
  "is_incident_close": false,
  "reasoning": "Robo reportado por cliente, requiere escalamiento inmediato."
}
```

---

## Example 6

Group: Chile Freight
Sender role: cliente
Timestamp: 2026-04-15T08:00:00-03:00
Previous context:
(inicio de día)

Message to classify:
"Buenos días 👍"

Expected JSON:
```json
{
  "category": "saludo_ruido",
  "bucket": "C",
  "sentiment": 0.1,
  "urgency": "baja",
  "is_incident_open": false,
  "is_incident_close": false,
  "reasoning": "Saludo matutino rutinario sin contenido operativo."
}
```

---

## Example 7

Group: CDMX Ops
Sender role: cliente
Timestamp: 2026-04-15T15:00:00-06:00
Previous context:
[agente_99] Entregamos en puerta del destinatario.

Message to classify:
"Les comparto foto de evidencia firmada, recibido conforme."

Expected JSON:
```json
{
  "category": "confirmacion_evidencias",
  "bucket": "A",
  "sentiment": 0.5,
  "urgency": "baja",
  "is_incident_open": false,
  "is_incident_close": true,
  "reasoning": "Cliente confirma recepción con evidencia, cierra el ciclo."
}
```

Nota: Este es un caso edge donde `confirmacion_evidencias` (bucket A) también cierra incidencia. El modelo debe priorizar la categoría por el contenido (evidencia) pero marcar el close para reflejar que hay resolución implícita.

---

## Example 8

Group: Bogotá Ops
Sender role: agente_99
Timestamp: 2026-04-15T13:00:00-05:00
Previous context:
(sin contexto)

Message to classify:
"Reportamos bloqueo en Autopista Norte por manifestación, estamos buscando ruta alterna."

Expected JSON:
```json
{
  "category": "problema_manifestacion",
  "bucket": "B",
  "sentiment": -0.3,
  "urgency": "media",
  "is_incident_open": false,
  "is_incident_close": false,
  "reasoning": "Agente proactivo reporta bloqueo externo, no es queja de cliente."
}
```
