# T0 Spike — Incident Reconstruction

**Objetivo:** validar en semanas 1-2 si el approach heurístico de `woi-analyzer/src/woi_analyzer/incident_reconstructor.py` es suficiente, o si hay que invertir en clustering semántico más sofisticado.

**Sample:** 500 mensajes reales de 1-2 grupos internos de 99minutos después de que el listener esté estable.

## Proceso

1. Dejar correr listener 7-10 días en 1-2 grupos internos activos.
2. Clasificar todos los mensajes con Sonnet (pipeline normal).
3. Exportar ~500 mensajes a un JSON plano con `scripts/export_sample.py`.
4. Santi o Ops labeler revisa manualmente y agrupa en **ground-truth incidents** vía spreadsheet.
5. Correr `scripts/evaluate_heuristic.py` que compara output del heurístico vs ground-truth manual.
6. Métrica: **F1 a nivel de incidente** (precision + recall de boundaries de apertura/cierre y owner).

## Criterios de decisión

| F1 score | Acción |
|---|---|
| ≥0.75 | Heurístico OK. Pasar a V1 con el módulo actual. |
| 0.55-0.74 | Mejorar heurístico con 2-3 reglas específicas (agrupar por keyword match, refinar cierre). |
| <0.55 | Diseñar approach semántico: embedding de mensajes + clustering por ventana temporal. |

## Archivos

- `scripts/export_sample.py` — dump de mensajes clasificados a JSON.
- `scripts/evaluate_heuristic.py` — compara heurístico vs ground-truth manual.
- `data/ground_truth_template.csv` — template para labeler humano.
- `notebooks/exploration.ipynb` — análisis exploratorio (crear en semana 1).

## Output esperado

Documento `docs/incident-reconstruction-spike.md` con:
- F1 obtenido
- Patrones de error del heurístico
- Recomendación: mantener, mejorar, o reemplazar
- Si reemplazar: spec técnica del approach alternativo
