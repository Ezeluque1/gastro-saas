import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ValidationError, type FieldIssue } from '../errors/index.js';

/**
 * Validacion de entrada con Zod.
 *
 * Dos reglas que valen para toda la API:
 *
 *  - Se informan TODOS los campos invalidos juntos, no el primero que falla.
 *  - Un parametro o campo desconocido da 400. Un `staus=received` con un error
 *    de tipeo no puede devolver todos los pedidos sin avisar.
 *
 * docs/Backend: "Formato de errores" (Validacion) y "Paginacion y filtros"
 * (Parametros desconocidos dan 400).
 */

export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: FieldIssue[] = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        req.params = result.data as typeof req.params;
      } else {
        issues.push(...toFieldIssues(result.error, 'params'));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // En Express 5 `req.query` es un getter, asi que el valor convertido
        // por Zod (numeros, listas) se guarda aparte.
        req.validatedQuery = result.data;
      } else {
        issues.push(...toFieldIssues(result.error, 'query'));
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        issues.push(...toFieldIssues(result.error, 'body'));
      }
    }

    if (issues.length > 0) {
      next(new ValidationError(issues));
      return;
    }

    next();
  };
}

/**
 * Traduce los problemas de Zod al formato de `errors` del contrato: `pointer`
 * (JSON Pointer) para el cuerpo, `parameter` (nombre) para la query y la ruta.
 */
function toFieldIssues(
  error: z.ZodError,
  source: 'body' | 'query' | 'params',
): FieldIssue[] {
  return error.issues.map((issue) => {
    const base = { code: issue.code, detail: issue.message };

    if (source === 'body') {
      return { ...base, pointer: toJsonPointer(issue.path) };
    }

    return { ...base, parameter: issue.path.map(String).join('.') };
  });
}

/**
 * JSON Pointer segun RFC 6901: cada segmento va precedido de `/`, y dentro de
 * un segmento `~` se escribe `~0` y `/` se escribe `~1`.
 */
function toJsonPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '';

  return path
    .map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

/**
 * Hace que un objeto Zod rechace las claves que no conoce.
 *
 * Es el modo por defecto que usa toda la API: se envuelve el esquema con esto
 * en vez de confiar en que Zod descarte lo desconocido en silencio.
 */
export function strict<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.strictObject(shape);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Query ya validada y convertida por Zod. La fija validate(). */
      validatedQuery?: unknown;
    }
  }
}
