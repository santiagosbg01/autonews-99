# WOI — WhatsApp Ops Intelligence

Sistema automatizado de análisis de grupos de WhatsApp operativos de 99minutos.
Ingesta mensajes vía Baileys, los clasifica y resume con Claude Sonnet, y entrega reporte diario en Google Sheet.

**Estado:** V1 piloto interno (5-10 grupos). Ver [PRD-v1.1.md](./PRD-v1.1.md).
**Owner:** Santiago (CGO).

---

## Arquitectura

```
 WhatsApp ──▶ woi-listener (Node/Baileys) ──▶ Supabase (Postgres)
                                                    │
                                                    ▼
                                       woi-analyzer (Python/Claude)
                                           │           │
                                           ▼           ▼
                                     analysis     incidents
                                           │
                                           ▼
                              woi-reporter (Python/Sheets+Slack)
                                           │
                                           ▼
                                    Google Sheet + Slack DM

    woi-onboarding-ui (Streamlit) ◀─ ─ ─ ─ ─ ─ ▶ Supabase (manual mgmt)
```

## Stack

- **Baileys** (Node 20+) — captura WhatsApp multi-grupo
- **Supabase** (Postgres + Storage) — persistencia + backup de auth state
- **Anthropic Claude** — Sonnet (modelo único) para clasificación, análisis de grupos y resúmenes
- **Google Sheets API** — delivery del reporte
- **Slack Webhook** — notificación con link
- **Streamlit** — UI de onboarding manual (Santi)
- **Mac Mini M4** (16GB) como host con PM2 + launchd

## Estructura del repo

```
WOI/
├── PRD-v1.1.md                  # Spec del producto
├── README.md                    # Este archivo
├── .env.example                 # Template de variables de entorno
├── .gitignore
├── supabase/
│   ├── migrations/              # SQL migrations versionadas
│   └── README.md
├── woi-listener/                # Node.js + Baileys
├── woi-analyzer/                # Python: clasificación + incidents
├── woi-reporter/                # Python: Sheet + Slack
├── woi-onboarding-ui/           # Streamlit admin
├── woi-spike/                   # T0 spike de incident reconstruction
├── scripts/                     # launchd plists, setup scripts
└── docs/
    ├── runbook.md               # Operación diaria
    └── incident-reconstruction-spike.md
```

## Setup inicial (orden)

1. **Supabase**: crear proyecto Pro, aplicar migrations (`supabase/migrations/`).
2. **Env vars**: copiar `.env.example` → `.env` y llenar credenciales.
3. **Anthropic API key**: crear en console.anthropic.com, agregar a `.env`.
4. **Listener**: `cd woi-listener && npm install && npm run qr` (primera vez para vincular número).
5. **Analyzer**: `cd woi-analyzer && uv sync` (o `pip install -r requirements.txt`).
6. **Reporter**: `cd woi-reporter && uv sync`.
7. **Onboarding UI**: `cd woi-onboarding-ui && streamlit run app.py` — mapear groups + participants.
8. **Cron jobs**: `./scripts/install-launchd.sh` para registrar los jobs en macOS.

Detalle paso a paso: ver `docs/runbook.md`.

## V1 Milestones (8 semanas)

Ver `PRD-v1.1.md` sección "V1 Plan".

## Go/No-Go para V1.5

- 14 días consecutivos uptime ≥90%
- Accuracy Sonnet ≥85% vs spot-check humano sobre `RawSample_*`
- Santi abre el Sheet ≥4/7 días 2 semanas seguidas
- 0 bans del listener
- Costo real ≤$200/mes

## Licencia

Privado — 99minutos. No distribuir.
