"""
WOI — Onboarding UI (Streamlit)

Tres vistas:
  1. Grupos: listar y editar grupos detectados (cohort, TZ, país, vertical, HubSpot id).
  2. Participantes: mapear participantes a roles (cliente/agente_99/otro) y confirmar.
  3. Health: resumen rápido por grupo de últimos 7d para validación manual.

Auth simple vía STREAMLIT_PASSWORD en .env.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
import psycopg
import streamlit as st
from dotenv import load_dotenv
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

DB_URL = os.environ.get("SUPABASE_DB_URL")
PASSWORD = os.environ.get("STREAMLIT_PASSWORD", "")

st.set_page_config(page_title="WOI Admin", page_icon="·", layout="wide")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def check_password() -> bool:
    if not PASSWORD:
        st.error("STREAMLIT_PASSWORD no configurado en .env")
        st.stop()

    if st.session_state.get("auth_ok"):
        return True

    with st.form("login"):
        pwd = st.text_input("Password", type="password")
        if st.form_submit_button("Entrar"):
            if pwd == PASSWORD:
                st.session_state["auth_ok"] = True
                st.rerun()
            else:
                st.error("Password incorrecto.")
    return False


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
@st.cache_resource
def get_conn():
    if not DB_URL:
        st.error("SUPABASE_DB_URL no configurado")
        st.stop()
    return psycopg.connect(DB_URL, row_factory=dict_row, autocommit=True)


def query(sql: str, params: tuple = ()) -> list[dict]:
    with get_conn().cursor() as cur:
        cur.execute(sql, params)
        if cur.description:
            return cur.fetchall()
        return []


def execute(sql: str, params: tuple = ()) -> None:
    with get_conn().cursor() as cur:
        cur.execute(sql, params)


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------
def view_groups():
    st.header("Grupos detectados")
    st.caption(
        "Confirma país, zona horaria, vertical, cohorte, y HubSpot ID de cada grupo "
        "que el listener ha encontrado. Cambios guardan inmediatamente."
    )

    rows = query(
        """
        SELECT id, whatsapp_id, name, country, timezone, vertical,
               pilot_cohort, client_hubspot_id, is_active, notes,
               joined_at
        FROM groups
        ORDER BY joined_at DESC
        """
    )

    if not rows:
        st.info("No hay grupos aún. Agrega el listener a un grupo de WhatsApp para que aparezca aquí.")
        return

    df = pd.DataFrame(rows)
    st.metric("Total grupos", len(df))
    st.metric("Activos", int(df["is_active"].sum()))

    for r in rows:
        with st.expander(f"{r['name']}  ·  {r['pilot_cohort']}  ·  {r['country']}", expanded=False):
            c1, c2, c3 = st.columns(3)
            new_name = c1.text_input("Nombre", value=r["name"], key=f"name_{r['id']}")
            new_country = c2.selectbox(
                "País",
                ["MX", "CO", "CL", "PE", "AR", "OTHER"],
                index=["MX", "CO", "CL", "PE", "AR", "OTHER"].index(r["country"] or "MX"),
                key=f"country_{r['id']}",
            )
            new_tz = c3.text_input(
                "Timezone (IANA)",
                value=r["timezone"] or "America/Mexico_City",
                key=f"tz_{r['id']}",
            )

            c4, c5, c6 = st.columns(3)
            verticals = ["Envios99", "Freight99", "Tailor99", "Fulfill99", "Punto99", "Cross99", "OTHER"]
            new_vertical = c4.selectbox(
                "Vertical",
                verticals,
                index=verticals.index(r["vertical"] or "OTHER"),
                key=f"vert_{r['id']}",
            )
            cohorts = ["internal", "founder_friend", "external"]
            new_cohort = c5.selectbox(
                "Cohorte",
                cohorts,
                index=cohorts.index(r["pilot_cohort"] or "internal"),
                key=f"cohort_{r['id']}",
            )
            new_hs = c6.text_input(
                "HubSpot Company ID",
                value=r["client_hubspot_id"] or "",
                key=f"hs_{r['id']}",
            )

            c7, c8 = st.columns([3, 1])
            new_notes = c7.text_area("Notas", value=r["notes"] or "", height=70, key=f"notes_{r['id']}")
            new_active = c8.checkbox("Activo", value=bool(r["is_active"]), key=f"active_{r['id']}")

            if st.button("Guardar", key=f"save_{r['id']}", type="primary"):
                execute(
                    """
                    UPDATE groups SET
                        name = %s, country = %s, timezone = %s, vertical = %s,
                        pilot_cohort = %s, client_hubspot_id = NULLIF(%s,''),
                        is_active = %s, notes = NULLIF(%s, '')
                    WHERE id = %s
                    """,
                    (
                        new_name, new_country, new_tz, new_vertical,
                        new_cohort, new_hs, new_active, new_notes, r["id"],
                    ),
                )
                st.success("Guardado.")
                st.rerun()


def view_participants():
    st.header("Participantes")
    st.caption(
        "Asigna el rol de cada participante y confirma. Default es 'otro'; "
        "sin confirmación de Santi, el pipeline de clasificación no sabe quién es agente 99 vs cliente."
    )

    groups = query("SELECT id, name, pilot_cohort FROM groups WHERE is_active = TRUE ORDER BY name")
    if not groups:
        st.info("Sin grupos.")
        return
    group_opts = {f"{g['name']}  [{g['pilot_cohort']}]": g["id"] for g in groups}
    selected = st.selectbox("Grupo", list(group_opts.keys()))
    gid = group_opts[selected]

    only_pending = st.toggle("Solo no confirmados", value=True)

    sql = """
        SELECT id, phone, display_name, role, hubspot_owner_id,
               hubspot_contact_id, confirmed_by_santi,
               first_seen_at, last_seen_at
        FROM participants
        WHERE group_id = %s
    """
    if only_pending:
        sql += " AND confirmed_by_santi = FALSE"
    sql += " ORDER BY last_seen_at DESC"

    rows = query(sql, (gid,))
    if not rows:
        st.success("Todos los participantes de este grupo están confirmados.")
        return

    st.write(f"{len(rows)} participante(s)")
    roles = ["cliente", "agente_99", "otro"]
    for r in rows:
        with st.container(border=True):
            c1, c2, c3, c4, c5 = st.columns([2, 2, 1.5, 1.5, 1])
            c1.write(f"**{r['display_name'] or '(sin nombre)'}**")
            c1.caption(f"+{r['phone']}")
            new_role = c2.selectbox(
                "Rol",
                roles,
                index=roles.index(r["role"] or "otro"),
                key=f"role_{r['id']}",
                label_visibility="collapsed",
            )
            new_owner = c3.text_input(
                "HubSpot owner_id",
                value=r["hubspot_owner_id"] or "",
                key=f"owner_{r['id']}",
                label_visibility="collapsed",
                placeholder="HubSpot owner ID",
            )
            new_contact = c4.text_input(
                "HubSpot contact_id",
                value=r["hubspot_contact_id"] or "",
                key=f"contact_{r['id']}",
                label_visibility="collapsed",
                placeholder="HubSpot contact ID",
            )
            if c5.button("Confirmar", key=f"confirm_{r['id']}", type="primary"):
                execute(
                    """
                    UPDATE participants SET
                        role = %s,
                        hubspot_owner_id = NULLIF(%s,''),
                        hubspot_contact_id = NULLIF(%s,''),
                        confirmed_by_santi = TRUE
                    WHERE id = %s
                    """,
                    (new_role, new_owner, new_contact, r["id"]),
                )
                st.rerun()


def view_health():
    st.header("Health por grupo (últimos 7 días)")
    st.caption("Validación cualitativa rápida para Santi.")

    rows = query(
        """
        SELECT
            g.name,
            g.pilot_cohort,
            COUNT(m.id) AS total_msgs,
            COUNT(*) FILTER (WHERE a.bucket='A') AS count_a,
            COUNT(*) FILTER (WHERE a.bucket='B') AS count_b,
            COUNT(*) FILTER (WHERE a.bucket='C') AS count_c,
            ROUND(
                COUNT(*) FILTER (WHERE a.bucket='B')::NUMERIC
                / NULLIF(COUNT(m.id),0) * 100, 2
            ) AS ratio_b_pct,
            ROUND(AVG(a.sentiment)::NUMERIC, 3) AS sentiment_avg,
            MAX(m.timestamp) AS last_msg_at
        FROM groups g
        LEFT JOIN messages m
          ON m.group_id = g.id
         AND m.timestamp >= NOW() - INTERVAL '7 days'
        LEFT JOIN analysis a ON a.message_id = m.id
        WHERE g.is_active = TRUE
        GROUP BY g.id, g.name, g.pilot_cohort
        ORDER BY ratio_b_pct DESC NULLS LAST
        """
    )

    if not rows:
        st.info("Sin data aún.")
        return

    df = pd.DataFrame(rows)
    st.dataframe(df, use_container_width=True, hide_index=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if not check_password():
        return

    st.title("WOI · Admin")
    st.caption("Onboarding manual de grupos y participantes. Solo uso interno Santi.")

    tab1, tab2, tab3 = st.tabs(["Grupos", "Participantes", "Health (7d)"])
    with tab1:
        view_groups()
    with tab2:
        view_participants()
    with tab3:
        view_health()


if __name__ == "__main__":
    main()
