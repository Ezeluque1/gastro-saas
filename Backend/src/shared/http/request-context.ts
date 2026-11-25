import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

/**
 * Identificador de request.
 *
 * Lo genera SIEMPRE el servidor: no se acepta un valor que mande el cliente,
 * porque entonces cualquiera podria ensuciar o confundir los logs.
 *
 * Va en la cabecera `X-Request-Id` de toda respuesta, se escribe en el log y
 * se devuelve dentro del cuerpo de los errores. Es lo que conecta lo que ve el
 * usuario con lo que quedo registrado.
 *
 * docs/Backend: "Cabeceras" y "Ciclo de una request".
 */

export const REQUEST_ID_HEADER = 'X-Request-Id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Id de esta request. Siempre definido: lo fija requestContext(). */
      requestId: string;
    }
  }
}

export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  };
}

/**
 * Lee el id de la request sin asumir que el middleware ya corrio. Solo deberia
 * hacer falta en el manejador de errores, que puede recibir un error disparado
 * antes de requestContext().
 */
export function getRequestId(req: { requestId?: string }): string {
  return req.requestId ?? 'unknown';
}
