# Supabase — WOI

## Setup

1. Crear proyecto en [supabase.com](https://supabase.com) (plan Pro, $25/mes).
2. En Settings → Database, copiar la URL de conexión (`SUPABASE_DB_URL`) al `.env`.
3. Crear bucket de Storage llamado `woi-auth-backup` (privado) para backup del `auth_state` de Baileys.
4. Aplicar migrations en orden:

```bash
# Opción A: via Supabase CLI
supabase db push

# Opción B: via psql directo
psql "$SUPABASE_DB_URL" -f migrations/001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f migrations/002_taxonomy_seed.sql
```

## Schema overview (v1.1)

| Tabla | Propósito | Retención V1 |
|---|---|---|
| `groups` | Catálogo de grupos WhatsApp | Indefinida |
| `participants` | Personas por grupo, con rol (cliente/agente_99/otro) | Indefinida |
| `messages` | Mensajes raw de Baileys | Indefinida (V1 piloto interno) |
| `analysis` | Clasificación Claude por mensaje | Indefinida |
| `taxonomy` | Catálogo de 21 categorías × 3 buckets | Permanente |
| `incidents` | Hilos agrupados (open → close) | Indefinida |
| `ground_truth_samples` | (Histórica) muestras de la era Haiku↔Sonnet, ya no se escribe — todo el pipeline corre con Sonnet | Indefinida |
| `classification_feedback` | Loop Santi thumbs up/down | Indefinida |
| `daily_reports` | Snapshot histórico del reporte | Indefinida |

## Vistas útiles

- `vw_group_daily_health` — ratio B diario por grupo (30d)
- `vw_agent_leaderboard` — TTFR/TTR/resolución por agente (7d)
- `vw_open_incidents` — incidencias abiertas ordenadas por criticidad

## IP Allowlist

En producción, restringir acceso a Supabase a:
- IP del Mac Mini (para listener + analyzer + reporter)
- IPs de los miembros del equipo que necesiten acceso directo

## Backup

- **Raw data:** Supabase Pro incluye backup automático diario (7d retention free, 28d con add-on).
- **Auth state Baileys:** se sube cada 1h a `woi-auth-backup` bucket via listener, rotación 14 días.

## Nota importante V1 → V1.5

Cuando agreguemos el primer grupo **externo** (no internal ni founder_friend), hay que:

1. Definir política de retención real (probablemente 90d raw, 2 años analysis).
2. Implementar purge endpoint para ARCO requests.
3. Agregar columna `consent_collected_at` a `groups`.
4. Rotar todas las credenciales si el equipo ha cambiado.
