import type { ErrorRequestHandler, RequestHandler } from 'express';

import {
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  isAppError,
} from '../errors/index.js';
import { PROBLEM_CONTENT_TYPE, toProblem } from '../errors/problem.js';
import { logger } from '../logger/index.js';
import { captureError } from '../monitoring/index.js';

import { getRequestId } from './request-context.js';

/**
 * Manejador central de errores. Es el ultimo middleware que se registra.
 *
 * Con Express 5 no hace falta envolver los handlers `async`: una promesa
 * rechazada llega sola hasta aca.
 *
 * docs/Backend: "Manejo de errores" y "Formato de errores".
 */
export function errorHandler(): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const requestId = getRequestId(req);
    const normalized = normalize(error);
    const problem = toProblem(normalized, requestId);

    // Los 5xx son bugs o fallas de infraestructura: se registran completos,
    // con el error original, y se mandan al monitoreo.
    // Los 4xx son esperables: se registran sin el cuerpo del pedido, para que
    // las claves no lleguen al log.
    if (problem.status >= 500) {
      logger.error(
        { err: normalized, requestId, method: req.method, path: req.originalUrl },
        'request fallida',
      );
      captureError(normalized, { requestId, method: req.method, path: req.originalUrl });
    } else {
      logger.warn(
        { requestId, method: req.method, path: req.originalUrl, code: problem.code },
        'request rechazada',
      );
    }

    // Si ya se empezo a escribir la respuesta no se puede cambiar el estado ni
    // las cabeceras: se corta la conexion para no mandar un cuerpo a medias.
    if (res.headersSent) {
      res.destroy();
      return;
    }

    if (problem.status === 429 && typeof problem['retryAfterSeconds'] === 'number') {
      res.setHeader('Retry-After', String(problem['retryAfterSeconds']));
    }

    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  };
}

/**
 * Traduce a AppError los errores que levantan las librerias, para que salgan
 * con el codigo estable que define el contrato y no como un 500 genérico.
 */
function normalize(error: unknown): unknown {
  if (isAppError(error)) return error;

  if (typeof error === 'object' && error !== null && 'type' in error) {
    // Errores de body-parser (express.json).
    const parserError = error as { type?: string; message?: string };
    switch (parserError.type) {
      case 'entity.too.large':
        return new PayloadTooLargeError();
      case 'entity.parse.failed':
        return new ValidationError([
          { pointer: '', code: 'invalid_json', detail: 'El cuerpo no es JSON valido.' },
        ]);
      case 'encoding.unsupported':
        return new UnsupportedMediaTypeError();
      default:
        break;
    }
  }

  return error;
}

/**
 * Ruta inexistente. Se registra despues de todos los modulos y antes del
 * manejador de errores, para que un 404 salga en problem+json como el resto y
 * no con el HTML por defecto de Express.
 */
export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(new NotFoundError('La ruta solicitada no existe.'));
  };
}
