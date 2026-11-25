import { isAppError } from './app-error.js';
import type { AppError } from './app-error.js';

/**
 * Respuesta de error en formato `application/problem+json` (RFC 9457).
 *
 * Miembros estandar: `type`, `title`, `status`, `detail`.
 * Miembros propios: `code`, `requestId` y, en validacion, `errors`.
 *
 * `type` repite el codigo como URI relativa: no hace falta publicar una pagina
 * por error.
 *
 * docs/Backend: "Formato de errores".
 */
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly requestId: string;
  readonly [member: string]: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Lo que se responde ante un error inesperado. Nunca filtra detalles internos. */
const INTERNAL_ERROR = {
  code: 'internal_error',
  title: 'Error interno',
  status: 500,
  detail:
    'Ocurrio un error inesperado. Si vuelve a pasar, avisanos con el identificador.',
} as const;

export function toProblem(error: unknown, requestId: string): Problem {
  if (isAppError(error)) {
    return buildProblem(error, requestId);
  }

  // Cualquier cosa que no sea un AppError es un bug o una falla de
  // infraestructura: responde 500 sin stack, sin SQL y sin el mensaje
  // original. El requestId es lo que conecta la respuesta con el log.
  return {
    type: `/errors/${INTERNAL_ERROR.code}`,
    title: INTERNAL_ERROR.title,
    status: INTERNAL_ERROR.status,
    detail: INTERNAL_ERROR.detail,
    code: INTERNAL_ERROR.code,
    requestId,
  };
}

function buildProblem(error: AppError, requestId: string): Problem {
  return {
    ...error.extra,
    type: `/errors/${error.code}`,
    title: error.title,
    status: error.status,
    detail: error.detail,
    code: error.code,
    requestId,
  };
}
