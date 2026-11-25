import type { Server } from 'node:http';

import { createApp } from './app.js';
import { config } from './config/index.js';
import { disconnectDatabase } from './shared/db/index.js';
import { logger } from './shared/logger/index.js';
import {
  captureError,
  closeMonitoring,
  initMonitoring,
} from './shared/monitoring/index.js';

/**
 * Arranque y cierre ordenado.
 *
 * El cierre ordenado importa para el despliegue: deja terminar las requests en
 * curso (y, desde la Fase 5, las transacciones abiertas de un pedido) antes de
 * soltar el proceso, en vez de cortarlas a la mitad.
 */

// El monitoreo se inicializa lo antes posible, para que capture tambien los
// errores del arranque.
initMonitoring();

const app = createApp();

const server: Server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'servidor escuchando');
});

// Las conexiones SSE de la pantalla de recepcion (Fase 5) quedan abiertas con
// heartbeat, asi que el servidor no debe cerrar conexiones ociosas por su
// cuenta antes de que el cliente lo note.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'cerrando');

  // Si algo se cuelga, no quedarse colgado para siempre: el orquestador va a
  // matar el proceso igual, pero conviene salir con un codigo claro.
  const forceExit = setTimeout(() => {
    logger.error('el cierre ordenado no termino a tiempo');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    await disconnectDatabase();
    await closeMonitoring();
    logger.info('cerrado');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'error al cerrar');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}

// Un error que llego hasta aca dejo el proceso en un estado que no se puede
// razonar: se registra, se manda al monitoreo y se cierra para que el
// orquestador levante una instancia limpia.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'excepcion no capturada');
  captureError(error);
  void shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'promesa rechazada sin manejar');
  captureError(reason);
  void shutdown('unhandledRejection');
});
