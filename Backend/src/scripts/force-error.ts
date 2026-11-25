import { config } from '../config/index.js';
import { logger } from '../shared/logger/index.js';
import {
  captureError,
  closeMonitoring,
  initMonitoring,
  isMonitoringActive,
} from '../shared/monitoring/index.js';

/**
 * Fuerza un error de prueba para verificar que el monitoreo esta conectado de
 * punta a punta.
 *
 * Es la unica forma de comprobar ese punto del entregable de la Fase 0: que un
 * error del backend llegue efectivamente al panel del proveedor. No alcanza con
 * que el modulo compile.
 *
 * Se corre con `npm run monitoring:test`.
 *
 * docs/Backend: "Monitoreo".
 */

const TENANT_DE_PRUEBA = '00000000-0000-4000-8000-000000000000';

async function main(): Promise<void> {
  initMonitoring();

  // Sin DSN el modulo de monitoreo es un no-op silencioso, que es lo que
  // queremos en desarrollo y en CI. Pero si este script saliera en silencio,
  // pareceria que el circuito funciona cuando en realidad no se envio nada.
  if (!isMonitoringActive()) {
    logger.error(
      'El monitoreo esta inactivo porque MONITORING_DSN esta vacio. ' +
        'Carga el DSN de Better Stack en .env y volve a correr este script.',
    );
    process.exitCode = 1;
    return;
  }

  const marca = new Date().toISOString();
  const error = new Error(
    `Error de prueba del monitoreo (${marca}). ` +
      'Lo genera npm run monitoring:test a proposito: no es un fallo real.',
  );

  // Se manda con el mismo contexto que usa el manejador central, para verificar
  // de paso que el etiquetado funciona: tenant_id, route y method van como
  // etiquetas, y el request_id como contexto.
  captureError(error, {
    tenantId: TENANT_DE_PRUEBA,
    method: 'POST',
    path: '/scripts/force-error',
    requestId: `force-error-${marca}`,
  });

  // Este await no es opcional. El SDK manda los eventos en segundo plano, asi
  // que sin esperar el cierre el proceso termina antes de que salga nada y
  // parece que el monitoreo no funciona.
  await closeMonitoring();

  logger.info(
    { environment: config.NODE_ENV, tenantId: TENANT_DE_PRUEBA },
    'Error de prueba enviado. Tiene que aparecer en el panel en menos de un minuto, ' +
      'etiquetado con este tenant_id y sin datos personales.',
  );
}

await main();
