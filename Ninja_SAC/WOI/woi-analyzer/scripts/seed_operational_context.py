"""
Seed inicial de groups.operational_context.

Para cada grupo activo sin contexto, genera un draft estructurado a partir de:
  • nombre del grupo (extracción de cliente + servicio)
  • país y timezone
  • patrones conocidos (cliente famoso, vertical inferido)

El draft sigue la plantilla acordada: vocabulario, procesos rutinarios, SLA,
contactos clave, issues activos. Cada sección tiene placeholders [...] que
Santi edita después en /grupos/[id].

USO:
  python3 scripts/seed_operational_context.py [--force] [--dry-run]
    --force    sobrescribe contexto existente (default: solo grupos NULL)
    --dry-run  imprime los drafts sin escribir a DB
"""

from __future__ import annotations

import argparse
import os
import re
import sys

import psycopg
from psycopg.rows import dict_row


# Pistas conocidas por palabra clave en el nombre. Cada entrada agrega
# bullets específicos del cliente sobre la plantilla base. Lower-case.
CLIENT_HINTS: dict[str, dict] = {
    "amazon": {
        "client": "Amazon",
        "vertical": "última milla B2C — Amazon FBA / FBM",
        "vocab": [
            '"sortable / non-sortable" = clasificación de paquete por tamaño/peso (Amazon)',
            '"DSP" = Delivery Service Partner (operador de la última milla)',
            '"manifest" = corte de wave de envíos del día',
            '"OTR" = On Time Rate; "DPMO" = defectos por millón',
        ],
        "routines": [
            "Entregas de wave matutino y vespertino — son flujo normal, no incidente",
            "Reportes de capacidad por estación cada mañana",
        ],
        "decision_makers": "[KAM Amazon: ?] · [Operations Manager 99: ?]",
    },
    "walmart": {
        "client": "Walmart",
        "vertical": "cross-dock / distribución walmart marketplace + retail",
        "vocab": [
            '"crossdock" = punto de transferencia donde se redistribuye carga sin almacenar',
            '"XD" = abreviatura de crossdock',
            '"tren logístico" = ruta consolidada multi-cliente',
            '"manifiesto" = cierre de carga del día',
        ],
        "routines": [
            "Recepción y consolidación matutina (4-7am) — esperada, no es alerta",
            "Salida de tren logístico a CDs Walmart en horarios fijos",
        ],
        "decision_makers": "[KAM Walmart: ?] · [Coordinador XD: ?]",
    },
    "ikea": {
        "client": "IKEA",
        "vertical": "última milla muebles voluminosos (white-glove parcial)",
        "vocab": [
            '"big ticket" = paquete voluminoso o pesado (entrega especial)',
            '"installer" = personal con armado de muebles',
            '"reagendamiento" = común por tamaño y disponibilidad del cliente',
        ],
        "routines": [
            "Citas con ventana de 4h confirmadas el día previo",
            "Reportes de armado y satisfacción al cierre de cada entrega",
        ],
        "decision_makers": "[KAM IKEA: ?] · [Coordinador 99: ?]",
    },
    "falabella": {
        "client": "Falabella",
        "vertical": "marketplace + retail (CL/CO/PE)",
        "vocab": [
            '"big ticket" = electrodomésticos y muebles grandes',
            '"BU" = Business Unit',
            '"refleta" = mover paquetes entre rutas',
        ],
        "routines": [
            "Cortes diarios por tienda; reportes de SLA semanales",
        ],
        "decision_makers": "[KAM Falabella: ?] · [Operations 99: ?]",
    },
    "ripley": {
        "client": "Ripley",
        "vertical": "marketplace + retail Perú — recolección punto a punto",
        "vocab": [
            '"recolección MKP" = pickup en sellers del marketplace',
            '"CD" = centro de distribución',
        ],
        "routines": [
            "Pickups diarios programados a sellers; consolidación en CD",
        ],
        "decision_makers": "[KAM Ripley: ?] · [Coordinador recolección: ?]",
    },
    "casaluker": {
        "client": "Casa Luker",
        "vertical": "distribución consumo masivo Colombia",
        "vocab": [
            '"ruta" = trayecto fijo del día por zona',
        ],
        "routines": [
            "Salidas matutinas con carga predefinida por zona",
        ],
        "decision_makers": "[KAM Casa Luker: ?] · [Operaciones 99: ?]",
    },
    "casa luker": "casaluker",  # alias
    "fracht": {
        "client": "Fracht",
        "vertical": "freight forwarder cross-border MX-US (carga consolidada / contract logistics)",
        "vocab": [
            '"manifiesto" = lista consolidada de envíos cross-border',
            '"BL / Bill of Lading" = documento de embarque',
            '"aduana" = trámite normal en cross-border, NO alerta automática',
            '"se fue a aduana" = paso esperado del flujo, no problema',
        ],
        "routines": [
            "Trámite aduanal estándar cada cruce (no es incidente)",
            "Reportes de status al cliente final 1-2 veces al día",
        ],
        "decision_makers": "[KAM Fracht: ?] · [Operations cross-border: ?]",
    },
    "loginsa": {
        "client": "Loginsa",
        "vertical": "operador logístico Chile (3PL) — fulfillment + transporte",
        "vocab": [
            '"fulfillment" = picking + packing + dispatch dentro del CD',
        ],
        "routines": [
            "Cortes diarios de pedidos; consolidación con 99minutos para última milla",
        ],
        "decision_makers": "[KAM Loginsa: ?] · [Operations 99: ?]",
    },
    "wild lama": {
        "client": "Wild Lama",
        "vertical": "marketplace de moda outdoor Chile",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Wild Lama: ?] · [Operations 99: ?]",
    },
    "antartica": {
        "client": "Antártica",
        "vertical": "retail / outdoor Chile",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Antártica: ?] · [Operations 99: ?]",
    },
    "preunic": {
        "client": "Preunic",
        "vertical": "retail belleza/farma Chile",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Preunic: ?] · [Operations 99: ?]",
    },
    "klar": {
        "client": "Klar",
        "vertical": "neobanco México — entrega de tarjetas y kits financieros",
        "vocab": [
            '"kit" = paquete con tarjeta, contrato y onboarding',
            '"reagendamiento" = común por necesidad de firma física del cliente',
        ],
        "routines": [
            "Entregas con identificación obligatoria; reagendamientos esperados",
        ],
        "decision_makers": "[KAM Klar: ?] · [Operations 99: ?]",
    },
    "skydropx": {
        "client": "Skydropx",
        "vertical": "agregador de paquetería México — etiquetas multi-courier",
        "vocab": [
            '"guía" = etiqueta de envío',
        ],
        "routines": [],
        "decision_makers": "[KAM Skydropx: ?] · [Operations 99: ?]",
    },
    "envioclick": {
        "client": "Envíoclick",
        "vertical": "agregador / marketplace de envíos México",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Envíoclick: ?] · [Operations 99: ?]",
    },
    "envíoclick": "envioclick",
    "dropi": {
        "client": "Dropi",
        "vertical": "dropshipping LATAM (envíos contra entrega / COD)",
        "vocab": [
            '"COD" = cash on delivery (cobro contra entrega)',
            '"recoleccion" = recoger producto del seller antes de entregar',
        ],
        "routines": [
            "COD obliga a manejo de efectivo / liquidación al cliente",
        ],
        "decision_makers": "[KAM Dropi: ?] · [Operations 99: ?]",
    },
    "tendencys": {
        "client": "Tendencys",
        "vertical": "agencia ecommerce México — fulfillment para múltiples brands",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Tendencys: ?] · [Operations 99: ?]",
    },
    "enviame": {
        "client": "Envíame",
        "vertical": "agregador internacional de envíos (CL/CO/PE/MX)",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Envíame: ?] · [Operations 99: ?]",
    },
    "envíame": "enviame",
    "pomelo": {
        "client": "Pomelo",
        "vertical": "moda / retail Perú",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Pomelo: ?] · [Operations 99: ?]",
    },
    "gloria": {
        "client": "Gloria",
        "vertical": "consumo masivo lácteos Perú",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Gloria: ?] · [Operations 99: ?]",
    },
    "panorama": {
        "client": "Panorama",
        "vertical": "[completar]",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM: ?] · [Operations 99: ?]",
    },
    "landus": {
        "client": "Landus",
        "vertical": "[completar]",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Landus: ?] · [Operations 99: ?]",
    },
    "anava": {
        "client": "ANAVA",
        "vertical": "moda Colombia (Cali / Medellín)",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM ANAVA: ?] · [Operations 99: ?]",
    },
    "corbeta": {
        "client": "Corbeta",
        "vertical": "consumo masivo Colombia (Alkosto/Ktronix)",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Corbeta: ?] · [Operations 99: ?]",
    },
    "alkosto": "corbeta",
    "almacenes la 13": {
        "client": "Almacenes La 13",
        "vertical": "retail Colombia (Cali / Medellín)",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM La 13: ?] · [Operations 99: ?]",
    },
    "studio f": {
        "client": "Studio F",
        "vertical": "moda mujer Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Studio F: ?] · [Operations 99: ?]",
    },
    "bosi": {
        "client": "Bosi",
        "vertical": "calzado Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Bosi: ?] · [Operations 99: ?]",
    },
    "stilotex": {
        "client": "Stilotex",
        "vertical": "textil Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Stilotex: ?] · [Operations 99: ?]",
    },
    "domecq": {
        "client": "Domecq",
        "vertical": "licores Colombia",
        "vocab": [
            '"verificación de edad" = obligatoria al entregar (+18)',
        ],
        "routines": [
            "Verificación de edad bloquea entregas — es proceso normal",
        ],
        "decision_makers": "[KAM Domecq: ?] · [Operations 99: ?]",
    },
    "laika": {
        "client": "Laika",
        "vertical": "petshop ecommerce Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Laika: ?] · [Operations 99: ?]",
    },
    "macrotics": {
        "client": "Macrotics",
        "vertical": "tecnología Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Macrotics: ?] · [Operations 99: ?]",
    },
    "branchos": {
        "client": "Branchos",
        "vertical": "[completar]",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Branchos: ?] · [Operations 99: ?]",
    },
    "zuluaga": {
        "client": "Zuluaga y Soto",
        "vertical": "[completar — Colombia]",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Zuluaga: ?] · [Operations 99: ?]",
    },
    "santillana": {
        "client": "Santillana",
        "vertical": "editorial / libros Colombia",
        "vocab": [],
        "routines": [
            "Picos por inicio de año escolar y promociones",
        ],
        "decision_makers": "[KAM Santillana: ?] · [Operations 99: ?]",
    },
    "cañaveral": {
        "client": "Cañaveral",
        "vertical": "[completar]",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Cañaveral: ?] · [Operations 99: ?]",
    },
    "sumatec": {
        "client": "Sumatec",
        "vertical": "industrial / herramientas Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Sumatec: ?] · [Operations 99: ?]",
    },
    "koaj": {
        "client": "Koaj (Permoda)",
        "vertical": "moda joven Colombia",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Koaj: ?] · [Operations 99: ?]",
    },
    "permoda": "koaj",
    "oriflame": {
        "client": "Oriflame",
        "vertical": "venta directa cosméticos",
        "vocab": [
            '"consultora" = vendedora directa que recibe los pedidos',
        ],
        "routines": [
            "Entregas a consultoras concentradas en ciertos días/horarios",
        ],
        "decision_makers": "[KAM Oriflame: ?] · [Operations 99: ?]",
    },
    "diana med": {
        "client": "Diana Med (Grupo Diana)",
        "vertical": "salud / farma",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Diana: ?] · [Operations 99: ?]",
    },
    "megatiendas": {
        "client": "Megatiendas",
        "vertical": "retail",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Megatiendas: ?] · [Operations 99: ?]",
    },
    "colsubsidio": {
        "client": "Colsubsidio",
        "vertical": "caja de compensación Colombia (retail + servicios)",
        "vocab": [
            '"planta" = centro logístico Colsubsidio',
        ],
        "routines": [],
        "decision_makers": "[KAM Colsubsidio: ?] · [Operations 99: ?]",
    },
    "pasarex": {
        "client": "Pasarex",
        "vertical": "freight / cross-border",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Pasarex: ?] · [Operations 99: ?]",
    },
    "levi's": {
        "client": "Levi's",
        "vertical": "moda denim retail",
        "vocab": [],
        "routines": [],
        "decision_makers": "[KAM Levi's: ?] · [Operations 99: ?]",
    },
    "levi": "levi's",
    "usend": {
        "client": "Usend",
        "vertical": "envíos same-day US ↔ LATAM",
        "vocab": [],
        "routines": [
            "Same-day implica ventana cerrada de pickup y entrega el mismo día",
        ],
        "decision_makers": "[KAM Usend: ?] · [Operations 99: ?]",
    },
}


# Grupos internos / no-cliente (mesa chica, ATC, gestión interna)
INTERNAL_PATTERNS = [
    "mesa chica",
    "atc tendencys",
    "operacion 99 minutos",
    "gestión operación 99",
    "gestion operacion 99",
    "ph directo arranque",
    "centros de transferencia",
    "distribución mkp",
    "distribucion mkp",
    "recolección mkp",
    "recoleccion mkp",
    "lt 99 minutos-abasto",
]


def _resolve_hint(name_lower: str) -> dict | None:
    """Devuelve el dict de hints más específico que matchea el nombre."""
    for key, val in CLIENT_HINTS.items():
        if key in name_lower:
            # Resolver alias (string que apunta a otra entry)
            if isinstance(val, str):
                return CLIENT_HINTS.get(val)
            return val
    return None


def _is_internal(name_lower: str) -> bool:
    return any(p in name_lower for p in INTERNAL_PATTERNS)


def _country_label(code: str | None) -> str:
    return {
        "MX": "México", "PE": "Perú", "CO": "Colombia", "CL": "Chile",
        "EC": "Ecuador", "BR": "Brasil", "US": "Estados Unidos",
    }.get((code or "MX").upper(), code or "MX")


def _classify_country_from_name(name: str) -> str | None:
    """A veces el campo country no refleja el país real (DB legacy con MX por
    default). Inferir del nombre si hay pistas claras."""
    n = name.lower()
    if any(s in n for s in ["btá", "bogotá", "bogota", "cali", "medellin", "medellín", " co ", "colombia"]):
        return "CO"
    if any(s in n for s in [" cl ", "chile", "wild lama", "antartica", "antártica", "preunic", "loginsa"]):
        return "CL"
    if any(s in n for s in [" pe ", "perú", "peru", "lima", "ripley", "pomelo", "gloria"]):
        return "PE"
    if "🇵🇪" in name:
        return "PE"
    if "🇨🇴" in name:
        return "CO"
    if "🇨🇱" in name:
        return "CL"
    return None


def build_draft(group: dict) -> str:
    name = group["name"]
    name_lower = name.lower()
    db_country = group.get("country")
    inferred_country = _classify_country_from_name(name) or db_country
    country_label = _country_label(inferred_country)
    timezone = group.get("timezone") or "America/Mexico_City"
    bh_start = group.get("business_hour_start", 9)
    bh_end = group.get("business_hour_end", 20)
    bh_days = group.get("business_days", []) or []
    days_label = (
        "Lun-Vie" if set(bh_days) == {"mon", "tue", "wed", "thu", "fri"}
        else "Lun-Sáb" if set(bh_days) == {"mon", "tue", "wed", "thu", "fri", "sat"}
        else "todos los días" if len(bh_days) == 7
        else ", ".join(bh_days)
    )

    hint = _resolve_hint(name_lower)
    is_internal = _is_internal(name_lower)

    # Header
    lines: list[str] = []
    lines.append(f"# Contexto operacional · {name}")
    lines.append("")

    if is_internal:
        lines.append("Tipo: GRUPO INTERNO 99 (no es chat directo con cliente final).")
        lines.append("Vocabulario y SLAs internos. Mensajes aquí son coordinación operativa, no incidentes externos.")
        lines.append("")

    # Cliente / vertical
    if hint:
        lines.append(f"Cliente: {hint.get('client', '?')}")
        lines.append(f"Vertical / servicio: {hint.get('vertical', '[completar]')}")
    else:
        # Heurística simple para extraer el "otro" lado del nombre
        other = re.sub(r"99\s*-?\s*minutos|99\s*min(?:utos?)?|99\s*mx", "",
                       name, flags=re.IGNORECASE)
        other = re.sub(r"[+/\-|]", " ", other).strip()
        other = re.sub(r"\s{2,}", " ", other) or "[cliente / servicio]"
        lines.append(f"Cliente: {other}")
        lines.append("Vertical / servicio: [completar — última milla / cross-border / fulfillment / etc.]")

    lines.append(f"País: {country_label}")
    lines.append(f"Timezone: {timezone}")
    lines.append(f"Horario laboral: {bh_start:02d}:00–{bh_end:02d}:00 · {days_label}")
    lines.append(f"Volumen típico: [~N envíos/día]")
    lines.append("")

    # Vocabulario
    lines.append("Vocabulario propio (palabras del grupo y su significado):")
    if hint and hint.get("vocab"):
        for v in hint["vocab"]:
            lines.append(f"  - {v}")
    else:
        lines.append('  - "manifiesto" = [si aplica: corte diario de envíos]')
        lines.append('  - "POD" = foto/evidencia de entrega')
        lines.append('  - "ruta XX" = identificador de viaje del día')
        lines.append("  - [agregar términos propios del cliente]")
    lines.append("")

    # Procesos rutinarios (NO son alertas)
    lines.append("Procesos rutinarios (NO son problemas — Sonnet NO debe abrirlos como incidente):")
    if hint and hint.get("routines"):
        for r in hint["routines"]:
            lines.append(f"  - {r}")
    else:
        lines.append("  - Reporte de cierre diario al final del turno")
        lines.append("  - Confirmación de salida con foto / manifiesto")
        lines.append("  - [agregar procesos propios]")
    lines.append("")

    # SLA
    lines.append("SLA acordado con el cliente:")
    lines.append(f"  - Primera respuesta: < 30 min en horario laboral ({bh_start:02d}:00-{bh_end:02d}:00)")
    lines.append("  - Resolución / cierre: < 24h hábiles")
    lines.append("  - Escalamiento si: cliente repite la queja, hay daño económico, o pasa de la urgencia 'alta'")
    lines.append("")

    # Decision makers
    lines.append("Contactos clave:")
    if hint and hint.get("decision_makers"):
        lines.append(f"  - {hint['decision_makers']}")
    else:
        lines.append("  - KAM 99: [nombre, teléfono]")
        lines.append("  - Decision maker cliente: [nombre, rol]")
    lines.append("")

    # Issues activos
    lines.append("Issues activos / temas recurrentes esta semana:")
    lines.append("  - [borrar cuando se resuelva — ej: retraso en CD Tultitlán los lunes]")
    lines.append("")

    lines.append("---")
    lines.append("(borrador inicial generado automáticamente — edítalo en /grupos/[id] para precisar)")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="sobrescribe contexto existente (default: solo NULL)")
    parser.add_argument("--dry-run", action="store_true",
                        help="imprime drafts sin escribir a DB")
    parser.add_argument("--limit", type=int, default=None,
                        help="máximo de grupos a procesar (debug)")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        print("ERROR: SUPABASE_DB_URL no está en el entorno", file=sys.stderr)
        sys.exit(1)

    with psycopg.connect(url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            where = "" if args.force else "AND operational_context IS NULL"
            cur.execute(f"""
                SELECT id, name, timezone, country, vertical, pilot_cohort,
                       business_hour_start, business_hour_end, business_days,
                       operational_context
                FROM groups
                WHERE is_active = TRUE
                {where}
                ORDER BY name
            """)
            groups = cur.fetchall()

        if args.limit:
            groups = groups[: args.limit]

        print(f"Grupos a procesar: {len(groups)} (force={args.force}, dry_run={args.dry_run})")

        updated = 0
        for g in groups:
            draft = build_draft(g)
            if args.dry_run:
                print(f"\n=== [{g['id']}] {g['name']} ===")
                print(draft)
                continue
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE groups SET operational_context = %s WHERE id = %s",
                    (draft, g["id"]),
                )
            updated += 1

        if not args.dry_run:
            conn.commit()
            print(f"OK — {updated} grupos actualizados")


if __name__ == "__main__":
    main()
