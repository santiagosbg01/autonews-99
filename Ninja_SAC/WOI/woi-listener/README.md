# woi-listener

Listener WhatsApp vía Baileys. Ingresa mensajes de grupos operativos a Supabase, respaldaa `auth_state` a Storage cada hora, y se auto-reinicia con PM2.

## Setup inicial (Mac Mini M4)

```bash
# 1. Instalar deps
cd woi-listener
npm install

# 2. Asegurarse que .env (en la raíz del repo WOI) esté lleno con:
#    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET,
#    SLACK_HEALTHCHECK_WEBHOOK

# 3. Primera vez: escanear QR desde WhatsApp del SIM dedicado
npm run qr
# → se imprime QR en la terminal
# → abrir WhatsApp en el SIM (Menú → Dispositivos vinculados → Vincular dispositivo)
# → escanear QR
# → aparece "Connection OPEN" → Ctrl+C para detener

# 4. Levantar en PM2
npm run pm2:start
pm2 save
pm2 startup   # seguir las instrucciones que imprime (una vez, para auto-start en reboot)
```

## Operación

```bash
npm run pm2:logs           # Logs en vivo
npm run pm2:restart        # Reiniciar manualmente
npm run pm2:stop           # Detener
node src/scripts/healthcheck.js    # Check desde otra terminal (exit 0 = healthy)
node src/scripts/restore-auth.js   # Restaurar auth_state desde Supabase Storage
```

## Qué hace

1. **Conexión a WhatsApp** usando credenciales de `auth_state/` (MultiFileAuthState).
2. **Ingesta**: por cada mensaje en grupo (`@g.us`), upsert `groups` y `participants`, insert en `messages` con dedup por `whatsapp_msg_id`.
3. **Backup de `auth_state`** cada 60min a Supabase Storage (`woi-auth-backup/auth_state/`), rotación 14 días.
4. **Healthcheck** interno cada 5min → si socket cerrado o sin actividad >2min, ping a Slack.
5. **Auto-reconexión** con backoff exponencial, hasta 10 intentos.

## Modo solo lectura (V1)

- **Nunca** envía mensajes salientes.
- **Ignora** eventos `messages.update` y `messages.delete` (decisión v1.1).
- `markOnlineOnConnect: false` para reducir fingerprint.

## Recovery

Si el Mac se reinicia y Baileys no reconecta:

```bash
# 1. Probar restaurar auth_state desde Storage
npm run restore-auth

# 2. Si falla, volver a escanear QR
rm -rf auth_state/
npm run qr
```

Si el número es baneado:

```bash
# 1. Cambiar SIM al standby (LISTENER_SIM_STANDBY_PHONE en .env)
# 2. Borrar auth_state
rm -rf auth_state/
# 3. Escanear QR con el standby
npm run qr
# 4. Agregar el número standby a los grupos (staggered, 1 cada 2-3 días)
```

## Riesgos y mitigaciones

- **Ban del número**: staggered onboarding + standby SIM + no bulk-add. Aceptado en PRD v1.1.
- **Corrupción de auth_state**: backup cada 1h a Storage, restore disponible.
- **Mac Mini reboot por update macOS**: PM2 `pm2 startup` configura auto-arranque.

## Observabilidad

- Logs: `woi-listener/logs/out.log` y `error.log` (rotados por PM2)
- Healthcheck pings: canal Slack configurado en `SLACK_HEALTHCHECK_WEBHOOK`
- Healthcheck externo (launchd cron cada 15min): `src/scripts/healthcheck.js`
