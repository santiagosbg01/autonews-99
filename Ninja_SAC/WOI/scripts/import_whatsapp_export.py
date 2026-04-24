#!/usr/bin/env python3
"""
Importa un export de WhatsApp (.txt) a Supabase.

Uso:
  python3 import_whatsapp_export.py <archivo.txt> <nombre_del_grupo>

Ejemplo:
  python3 import_whatsapp_export.py "Chat de Gloria.txt" "99minutos - Gloria"

El script:
  - Parsea el formato estándar de WhatsApp export
  - Solo importa mensajes de HOY (o todos si pasas --all)
  - Es idempotente: no duplica mensajes ya existentes
"""

import sys
import re
import os
import hashlib
import json
import argparse
from datetime import datetime, timezone, date
from pathlib import Path

# ── Supabase (via HTTP directo, sin dependencia extra) ──────────────────────
import urllib.request
import urllib.error
import urllib.parse

SUPABASE_URL = "https://tajtivdgtzptcgczmxzr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhanRpdmRndHpwdGNnY3pteHpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjY4OTg0NSwiZXhwIjoyMDkyMjY1ODQ1fQ.Uxj5WdKjbcX6nlJUgFObKUh_GlgHOCXoHU8e4RkYW08"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def sb_get(path, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def sb_post(path, data, prefer="return=minimal"):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    body = json.dumps(data).encode()
    h = {**HEADERS, "Prefer": prefer}
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()) if r.read() else None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        # 409 = duplicate (unique constraint) → OK
        if e.code == 409 or '"23505"' in body:
            return None
        raise


# ── Parser de exports de WhatsApp ──────────────────────────────────────────
# Formatos soportados:
#   [23/4/26, 10:30:00] Nombre: mensaje
#   [23/04/2026, 10:30:00] Nombre: mensaje
#   23/4/26, 10:30:00 - Nombre: mensaje
#   23/04/2026, 10:30:00 - Nombre: mensaje

MSG_PATTERNS = [
    # [DD/MM/YY, HH:MM:SS a. m.] Sender: msg
    re.compile(r'^\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[ap]\.?\s*m\.?\]\s*(.+?):\s(.*)$', re.IGNORECASE),
    # [DD/MM/YY, HH:MM:SS] Sender: msg  (24h)
    re.compile(r'^\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s(.*)$'),
    # DD/MM/YY, HH:MM a. m. - Sender: msg
    re.compile(r'^(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[ap]\.?\s*m\.?\s*-\s*(.+?):\s(.*)$', re.IGNORECASE),
    # DD/MM/YY, HH:MM - Sender: msg  (24h)
    re.compile(r'^(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+?):\s(.*)$'),
    # DD/MM/YY HH:MM a. m. - Sender: msg  ← formato México sin coma
    re.compile(r'^(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[ap]\.?\s*m\.?\s*-\s*(.+?):\s(.*)$', re.IGNORECASE),
    # DD/MM/YY HH:MM - Sender: msg  (24h sin coma)
    re.compile(r'^(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+?):\s(.*)$'),
]

SYSTEM_SENDERS = {
    'los mensajes y las llamadas', 'messages and calls', 'cifrado de extremo a extremo',
    'end-to-end encryption', 'cambió el asunto del grupo', 'changed the subject',
    'añadió', 'added', 'salió', 'left', 'eliminó', 'removed',
}


def parse_date(date_str, time_str, is_12h=False):
    """Parsea fecha/hora de WhatsApp a datetime UTC."""
    date_str = date_str.strip()
    time_str = time_str.strip()

    # Normalizar año de 2 dígitos
    parts = date_str.split('/')
    if len(parts) == 3 and len(parts[2]) == 2:
        parts[2] = '20' + parts[2]
    date_str = '/'.join(parts)

    fmt_date = '%d/%m/%Y'
    for fmt_time in ['%I:%M:%S %p', '%I:%M %p', '%H:%M:%S', '%H:%M']:
        try:
            dt = datetime.strptime(f"{date_str} {time_str}", f"{fmt_date} {fmt_time}")
            # Asumir hora de México (UTC-6)
            from datetime import timedelta
            dt = dt.replace(tzinfo=timezone(timedelta(hours=-6)))
            return dt.astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def parse_export(filepath, only_today=True):
    """Lee el archivo y devuelve lista de mensajes parseados."""
    messages = []
    today = date.today()

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()

    current = None

    for line in lines:
        line = line.rstrip('\n')
        matched = False

        for pat in MSG_PATTERNS:
            m = pat.match(line)
            if m:
                matched = True
                # Guardar mensaje anterior si existe
                if current:
                    messages.append(current)

                date_s, time_s, sender, content = m.group(1), m.group(2), m.group(3).strip(), m.group(4).strip()
                is_12h = bool(re.search(r'[ap]\.?\s*m\.?', line, re.IGNORECASE))

                # Detectar indicador AM/PM en la línea (maneja "a. m." y "p. m.")
                ampm_match = re.search(r'\b(a\.?\s*m\.?|p\.?\s*m\.?)\b', line, re.IGNORECASE)
                if ampm_match:
                    raw = ampm_match.group(1)
                    normalized = re.sub(r'[\s\.]', '', raw).upper()  # "a. m." → "AM"
                    time_s = f"{time_s} {normalized}"

                dt = parse_date(date_s, time_s, is_12h)
                if dt is None:
                    current = None
                    break

                if only_today and dt.date() != today:
                    current = None
                    break

                # Filtrar mensajes del sistema
                if any(s in sender.lower() for s in SYSTEM_SENDERS):
                    current = None
                    break

                # Filtrar mensajes omitidos/media
                if content in ['<Multimedia omitido>', '<Media omitted>', '']:
                    content = None

                # Extraer teléfono si el sender es un número
                phone_match = re.match(r'^[\+\s\d\-\(\)]+$', sender.replace(' ', ''))
                sender_phone = re.sub(r'[\s\+\-\(\)]', '', sender) if phone_match else 'imported'

                current = {
                    'timestamp': dt.isoformat(),
                    'sender_display_name': sender if not phone_match else None,
                    'sender_phone': sender_phone,
                    'content': content,
                }
                break

        if not matched and current and line.strip():
            # Continuación de mensaje anterior
            if current.get('content'):
                current['content'] += '\n' + line.strip()
            else:
                current['content'] = line.strip()

    if current:
        messages.append(current)

    return messages


def generate_msg_id(group_id, timestamp, sender, content):
    raw = f"import|{group_id}|{timestamp}|{sender}|{content or ''}"
    return 'imp_' + hashlib.sha1(raw.encode()).hexdigest()[:16]


def main():
    parser = argparse.ArgumentParser(description='Importar export de WhatsApp a Supabase')
    parser.add_argument('archivo', help='Ruta al archivo .txt exportado de WhatsApp')
    parser.add_argument('grupo', help='Nombre exacto del grupo en el dashboard')
    parser.add_argument('--all', action='store_true', help='Importar todo el historial (no solo hoy)')
    parser.add_argument('--dry-run', action='store_true', help='Solo mostrar lo que se importaría')
    args = parser.parse_args()

    filepath = Path(args.archivo)
    if not filepath.exists():
        print(f"❌ Archivo no encontrado: {filepath}")
        sys.exit(1)

    # Buscar grupo en Supabase
    print(f"🔍 Buscando grupo '{args.grupo}'...")
    groups = sb_get('groups', f'?select=id,name&name=eq.{urllib.parse.quote(args.grupo)}')

    if not groups:
        # Buscar por nombre aproximado
        all_groups = sb_get('groups', '?select=id,name')
        print("Grupos disponibles:")
        for g in all_groups:
            print(f"  [{g['id']}] {g['name']}")
        print(f"\n❌ No se encontró grupo con nombre exacto: '{args.grupo}'")
        print("   Usa el nombre exacto de la lista de arriba.")
        sys.exit(1)

    group = groups[0]
    print(f"✅ Grupo encontrado: [{group['id']}] {group['name']}")

    # Parsear mensajes
    only_today = not args.all
    print(f"📖 Parseando {'mensajes de hoy' if only_today else 'todo el historial'}...")
    messages = parse_export(filepath, only_today=only_today)
    print(f"   {len(messages)} mensajes encontrados en el archivo")

    if not messages:
        print("⚠️  No se encontraron mensajes para importar.")
        sys.exit(0)

    if args.dry_run:
        print("\n--- DRY RUN (primeros 5) ---")
        for m in messages[:5]:
            print(m)
        sys.exit(0)

    # Insertar en Supabase
    inserted = 0
    skipped = 0

    for msg in messages:
        msg_id = generate_msg_id(group['id'], msg['timestamp'], msg['sender_display_name'], msg['content'])
        row = {
            'whatsapp_msg_id': msg_id,
            'group_id': group['id'],
            'sender_phone': msg.get('sender_phone', 'imported'),
            'sender_display_name': msg.get('sender_display_name'),
            'timestamp': msg['timestamp'],
            'content': msg['content'],
            'analyzed': False,
            'is_forwarded': False,
        }

        try:
            result = sb_post('messages', row, prefer='return=minimal')
            inserted += 1
            if inserted % 10 == 0:
                print(f"   {inserted}/{len(messages)} insertados...", end='\r')
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if '23505' in body or e.code == 409:
                skipped += 1
            else:
                print(f"\n⚠️  Error en mensaje {msg_id}: {body[:100]}")

    print(f"\n✅ Listo: {inserted} insertados, {skipped} ya existían")
    print(f"   Recarga el dashboard para ver los mensajes de {group['name']}")


if __name__ == '__main__':
    main()
