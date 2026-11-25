import type { RequestHandler } from 'express';

import { UnsupportedMediaTypeError } from '../errors/index.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Exige `Content-Type: application/json` en las escrituras que llevan cuerpo.
 *
 * No es solo prolijidad: es parte de la defensa contra CSRF. Un formulario de
 * otro sitio solo puede mandar `application/x-www-form-urlencoded`,
 * `multipart/form-data` o `text/plain`; para mandar JSON necesita un preflight
 * de CORS, que el servidor no responde.
 *
 * DELETE queda afuera porque no lleva cuerpo.
 *
 * docs/Backend: "Proteccion CSRF", punto 4.
 */
export function jsonOnly(): RequestHandler {
  return (req, _res, next) => {
    if (!METHODS_WITH_BODY.has(req.method)) {
      next();
      return;
    }

    // Un POST sin cuerpo es valido (por ejemplo las acciones
    // /orders/{id}/cancel sin datos): si no declara Content-Type y no manda
    // nada, no hay nada que rechazar.
    if (!req.headers['content-type']) {
      const hasBody =
        req.headers['content-length'] !== undefined &&
        req.headers['content-length'] !== '0';
      const isChunked = req.headers['transfer-encoding'] !== undefined;

      if (hasBody || isChunked) {
        next(new UnsupportedMediaTypeError());
        return;
      }

      next();
      return;
    }

    if (!req.is('application/json')) {
      next(new UnsupportedMediaTypeError());
      return;
    }

    next();
  };
}
