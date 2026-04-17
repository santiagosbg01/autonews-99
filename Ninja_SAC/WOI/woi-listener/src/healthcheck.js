import { config } from './config.js';
import { logger } from './logger.js';

let lastHealthySignalAt = Date.now();
let consecutiveFailures = 0;

/**
 * Llamar cuando el listener recibe un mensaje o evento → señal de que sigue vivo.
 */
export function markHealthy() {
  lastHealthySignalAt = Date.now();
  consecutiveFailures = 0;
}

/**
 * Llamar desde el loop de healthcheck. Si no hemos visto actividad >2min,
 * pingeamos a Slack.
 */
async function checkHealth(sock) {
  const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2min
  const silentFor = Date.now() - lastHealthySignalAt;

  const isConnected = sock?.ws?.readyState === 1; // OPEN

  if (!isConnected) {
    consecutiveFailures += 1;
    logger.warn({ consecutiveFailures, silentForMs: silentFor }, 'Healthcheck: socket not OPEN');

    if (consecutiveFailures === 2) {
      await notifySlack(
        `:rotating_light: *WOI Listener healthcheck FAIL*\n` +
        `Socket not OPEN for ${Math.round(silentFor / 1000)}s. ` +
        `PM2 debe reiniciar automáticamente. Revisar logs en Mac Mini.`
      );
    }
    return;
  }

  if (silentFor > STALE_THRESHOLD_MS) {
    consecutiveFailures += 1;
    logger.warn({ consecutiveFailures, silentForMs: silentFor }, 'Healthcheck: no messages/events received recently');
    if (consecutiveFailures === 2) {
      await notifySlack(
        `:warning: *WOI Listener stale*\n` +
        `Sin actividad hace ${Math.round(silentFor / 60000)} min. Socket conectado pero silencioso.`
      );
    }
  } else {
    if (consecutiveFailures > 0) {
      await notifySlack(`:white_check_mark: *WOI Listener recovered* (after ${consecutiveFailures} fails)`);
    }
    consecutiveFailures = 0;
  }
}

async function notifySlack(text) {
  if (!config.slack.healthcheckWebhook) return;
  try {
    await fetch(config.slack.healthcheckWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (err) {
    logger.error({ err }, 'Failed to notify Slack about healthcheck');
  }
}

export function startHealthcheckLoop(getSock) {
  const intervalMs = config.listener.healthcheckIntervalSec * 1000;
  logger.info({ intervalSec: config.listener.healthcheckIntervalSec }, 'Starting healthcheck loop');
  const handle = setInterval(() => {
    checkHealth(getSock()).catch((err) =>
      logger.error({ err }, 'Healthcheck loop error')
    );
  }, intervalMs);
  return handle;
}
