import * as Sentry from '@sentry/node';

import { config } from '../../config/index.js';
import { logger } from '../logger/index.js';

/**
 * Captura de errores. Unica puerta de salida hacia el proveedor de monitoreo,
 * para no dispersar llamadas por el codigo: si manana cambia el proveedor,
 * cambia este archivo y nada mas.
 *
 * En el MVP el proveedor es Better Stack, al que se le habla con el SDK
 * compatible con Sentry. Cambiar de proveedor es cambiar el DSN.
 *
 * Sin `MONITORING_DSN` todo esto queda inactivo, asi que desarrollo y CI no
 * necesitan cuenta ni conexion a internet.
 *
 * docs/Backend: "Monitoreo".
 */

let active = false;

export function initMonitoring(): void {
  if (active) return;

  if (config.MONITORING_DSN === '') {
    logger.debug('monitoreo inactivo: falta MONITORING_DSN');
    return;
  }

  Sentry.init({
    dsn: config.MONITORING_DSN,
    environment: config.NODE_ENV,
    // Solo errores en el MVP: no se mide performance, que es lo que mas
    // consume del plan gratuito.
    tracesSampleRate: 0,
    // Desde la version 11 del SDK no existe `sendDefaultPii`: no enviar datos
    // personales es el comportamiento por defecto y no hay que pedirlo. Si se
    // actualiza el SDK, verificar que siga siendo asi.
    // Cortar la profundidad de serializacion es otra proteccion: evita que un
    // objeto grande arrastre datos del cliente al reporte.
    normalizeDepth: 3,
    maxValueLength: 2000,
  });

  active = true;
  logger.info('monitoreo activo');
}

/** Contexto que acompana a un error. Nunca datos personales ni credenciales. */
export interface ErrorContext {
  readonly requestId?: string;
  readonly method?: string;
  readonly path?: string;
  /**
   * Va como ETIQUETA, no como dato libre, para que el proveedor pueda agrupar
   * y filtrar los errores por local.
   */
  readonly tenantId?: string;
}

export function captureError(error: unknown, context: ErrorContext = {}): void {
  if (!active) return;

  Sentry.withScope((scope) => {
    // Etiquetas: valores de baja cardinalidad, los que sirven para agrupar.
    if (context.tenantId !== undefined) scope.setTag('tenant_id', context.tenantId);
    if (context.path !== undefined) scope.setTag('route', context.path);
    if (context.method !== undefined) scope.setTag('method', context.method);

    // El request_id es unico por pedido: como etiqueta no agruparia nada, va
    // como contexto para poder saltar al log.
    if (context.requestId !== undefined) {
      scope.setContext('request', { request_id: context.requestId });
    }

    Sentry.captureException(error);
  });
}

/** Cierre ordenado: da tiempo a que salga lo que quedo en la cola. */
export async function closeMonitoring(timeoutMs = 2000): Promise<void> {
  if (!active) return;
  await Sentry.close(timeoutMs);
  active = false;
}

export function isMonitoringActive(): boolean {
  return active;
}
