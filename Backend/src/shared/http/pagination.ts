import { z } from 'zod';

import { ValidationError } from '../errors/index.js';

/**
 * Paginacion por cursor.
 *
 * Las listas que crecen sin parar (pedidos, clientes, movimientos de caja y de
 * stock, rendiciones, auditoria) no se paginan con OFFSET: un pedido nuevo que
 * entra mientras se pagina corre las filas y repite o saltea resultados, y el
 * costo crece con la profundidad.
 *
 * El cursor es un valor opaco para el cliente. Lleva adentro la posicion
 * (instante + id, que es el desempate) y el orden con el que se emitio: si
 * llega un cursor de otro orden se rechaza, porque seguir paginando con un
 * orden distinto devuelve resultados incoherentes.
 *
 * docs/Backend: "Paginacion y filtros".
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Posicion dentro de una lista ordenada. */
export interface CursorPosition {
  /** Valor de la columna de orden, serializado. */
  readonly value: string;
  /** Id de la fila, que desempata cuando el valor se repite. */
  readonly id: string;
}

interface CursorPayload extends CursorPosition {
  /** Orden con el que se emitio este cursor, por ejemplo `-createdAt`. */
  readonly sort: string;
}

/** Como se devuelve una pagina. Toda lista responde `{ data, page }`. */
export interface Page<T> {
  readonly data: readonly T[];
  readonly page: {
    readonly limit: number;
    /** `null` en la ultima pagina. */
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/**
 * Esquema de los parametros de paginacion, para componer con los filtros de
 * cada endpoint. `limit` llega como texto en la query y se convierte aca.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function encodeCursor(position: CursorPosition, sort: string): string {
  const payload: CursorPayload = { ...position, sort };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodifica un cursor y verifica que corresponda al orden pedido.
 *
 * Un cursor corrupto, inventado o emitido con otro orden da `validation_error`:
 * es entrada del cliente, no un error del servidor.
 */
export function decodeCursor(cursor: string, expectedSort: string): CursorPosition {
  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const parsed = cursorPayloadSchema.safeParse(payload);
  if (!parsed.success) throw invalidCursor();

  if (parsed.data.sort !== expectedSort) {
    throw new ValidationError([
      {
        parameter: 'cursor',
        code: 'cursor_sort_mismatch',
        detail: 'El cursor corresponde a otro orden. Volve a pedir la primera pagina.',
      },
    ]);
  }

  return { value: parsed.data.value, id: parsed.data.id };
}

const cursorPayloadSchema = z.object({
  value: z.string(),
  id: z.string(),
  sort: z.string(),
});

function invalidCursor(): ValidationError {
  return new ValidationError([
    { parameter: 'cursor', code: 'invalid_cursor', detail: 'El cursor no es valido.' },
  ]);
}

/**
 * Arma la respuesta a partir de las filas leidas.
 *
 * Se consulta `limit + 1` filas y se pasan todas: la de sobra es la que dice si
 * hay mas paginas, sin tener que contar el total.
 */
export function buildPage<T>(
  rows: readonly T[],
  limit: number,
  sort: string,
  toPosition: (row: T) => CursorPosition,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    page: {
      limit,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(toPosition(last), sort) : null,
      hasMore,
    },
  };
}
