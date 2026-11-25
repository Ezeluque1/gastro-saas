import { pino } from 'pino';

import { config } from '../../config/index.js';

/**
 * Logs estructurados en JSON. Cada linea lleva el id de la request y, desde la
 * Fase 1, el tenant_id.
 *
 * docs/Backend: "Logs | Pino (JSON estructurado)".
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  // En desarrollo se lee mejor con colores; en produccion sale JSON crudo,
  // que es lo que consume Better Stack.
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
  // Nunca registrar credenciales ni tokens. Los 4xx se registran sin el cuerpo
  // del pedido para que las claves no lleguen al log.
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redactado]',
  },
});

export type Logger = typeof logger;
