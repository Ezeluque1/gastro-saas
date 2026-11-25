import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

import { config } from '../../config/index.js';
import { RateLimitedError } from '../errors/index.js';

/**
 * Freno general por IP. El limite estricto del login, por (local, usuario) y
 * por IP, es parte de la Fase 1 y se arma sobre este mismo helper.
 *
 * El rechazo sale por el manejador central como `rate_limited`, con la cabecera
 * `Retry-After`, igual que cualquier otro error del contrato.
 *
 * docs/Backend: "Seguridad HTTP" y la tabla de codigos de error.
 */
export function generalRateLimit(): RateLimitRequestHandler {
  const windowMs = 60_000;

  return rateLimit({
    windowMs,
    // Alto a proposito: es una red de contencion contra bucles y abuso, no el
    // limite de negocio. Un local con varias cajas y la pantalla de recepcion
    // abierta hace muchos pedidos legitimos por minuto.
    limit: config.isProduction ? 600 : 10_000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Las pruebas no deben depender de contadores compartidos entre casos.
    skip: () => config.isTest,
    handler: (_req, _res, next) => {
      next(new RateLimitedError(windowMs / 1000));
    },
  });
}
