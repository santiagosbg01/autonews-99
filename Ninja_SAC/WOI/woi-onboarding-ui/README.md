# woi-onboarding-ui

UI mínima en Streamlit para que Santi haga el onboarding manual de grupos y participantes.

## Setup

```bash
cd woi-onboarding-ui
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Asegurarse de tener `.env` en la raíz del repo WOI con:
- `SUPABASE_DB_URL`
- `STREAMLIT_PASSWORD` — contraseña para acceder a la UI

## Correr

```bash
streamlit run app.py
```

Por default corre en `http://localhost:8501`. No exponer a internet sin reverse proxy con TLS.

## Vistas

1. **Grupos**: cada grupo detectado por el listener aparece expandible con campos editables:
   - Nombre, país, timezone IANA, vertical, cohorte (internal/founder_friend/external), HubSpot Company ID, notas, activo.
2. **Participantes**: filtrable por grupo, muestra los que aún no están confirmados. Asignar rol + HubSpot IDs y marcar como confirmado.
3. **Health (7d)**: tabla de health por grupo con ratio B, volumen, sentiment.

## Flujo inicial (una sola vez por grupo)

1. Agregar el número listener al grupo en WhatsApp.
2. El listener detecta el grupo → aparece en la UI con defaults (cohort=internal, MX, TZ=CDMX).
3. Santi abre la UI → pestaña Grupos → expande el grupo → ajusta cohorte, TZ, vertical, HubSpot → guarda.
4. Santi cambia a pestaña Participantes → selecciona el grupo → marca cada persona como cliente/agente_99/otro → confirma.
5. Una vez confirmados los agentes, el pipeline de clasificación y los cálculos de TTFR empiezan a funcionar con accuracy real.

## Nota

Si no confirmas participantes, todos quedan con `role='otro'`. Eso significa que **ningún mensaje puede abrir una incidencia** (solo clientes pueden) y el pipeline subestima el volumen de incidencias reales.
