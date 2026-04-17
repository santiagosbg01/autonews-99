#!/usr/bin/env node
import { restoreLatestAuthState } from '../auth-backup.js';
import { logger } from '../logger.js';

(async () => {
  try {
    const restored = await restoreLatestAuthState();
    if (restored) {
      logger.info('Restore OK. Puedes arrancar el listener con `npm start`');
      process.exit(0);
    }
    logger.warn('No hay backup disponible en Storage. Arranca fresh con QR.');
    process.exit(2);
  } catch (err) {
    logger.fatal({ err }, 'Restore failed');
    process.exit(1);
  }
})();
