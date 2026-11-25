import { describe, expect, it } from 'vitest';

import { isAppError } from '../../src/shared/errors/index.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildPage,
  decodeCursor,
  encodeCursor,
  paginationQuerySchema,
} from '../../src/shared/http/pagination.js';

const SORT = '-createdAt';

interface Row {
  id: string;
  createdAt: string;
}

const rows: Row[] = Array.from({ length: 4 }, (_, i) => ({
  id: `id-${String(i)}`,
  createdAt: `2026-11-2${String(i)}T19:55:00Z`,
}));

const toPosition = (row: Row) => ({ value: row.createdAt, id: row.id });

describe('cursor', () => {
  it('va y vuelve sin perder la posicion', () => {
    const cursor = encodeCursor({ value: '2026-11-24T19:55:00Z', id: 'abc' }, SORT);

    expect(decodeCursor(cursor, SORT)).toEqual({
      value: '2026-11-24T19:55:00Z',
      id: 'abc',
    });
  });

  it('es opaco para el cliente', () => {
    const cursor = encodeCursor({ value: '2026-11-24T19:55:00Z', id: 'abc' }, SORT);

    // base64url: seguro en una URL sin escapar nada.
    expect(cursor).not.toContain('=');
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
  });

  it('rechaza un cursor emitido con otro orden', () => {
    // Seguir paginando con un orden distinto devuelve resultados incoherentes:
    // mejor cortar que mezclar.
    const cursor = encodeCursor({ value: 'x', id: 'y' }, '-createdAt');

    expect(() => decodeCursor(cursor, 'createdAt')).toThrow();

    try {
      decodeCursor(cursor, 'createdAt');
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('validation_error');
      expect(isAppError(error) && error.status).toBe(400);
    }
  });

  it.each([
    ['texto que no es base64', 'no-es-un-cursor!!'],
    ['base64 que no es JSON', Buffer.from('hola', 'utf8').toString('base64url')],
    [
      'JSON sin los campos esperados',
      Buffer.from('{"a":1}', 'utf8').toString('base64url'),
    ],
  ])('da validation_error con %s', (_caso, cursor) => {
    // Un cursor roto es entrada del cliente: 400, nunca un 500.
    try {
      decodeCursor(cursor, SORT);
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.status).toBe(400);
      expect(isAppError(error) && error.code).toBe('validation_error');
    }
  });
});

describe('paginationQuerySchema', () => {
  it('usa 25 por defecto', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: DEFAULT_LIMIT });
  });

  it('convierte el limite que llega como texto en la query', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it.each([['0'], ['101'], ['-1'], ['abc'], ['1.5']])('rechaza limit=%s', (limit) => {
    expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('acepta el maximo', () => {
    expect(paginationQuerySchema.parse({ limit: String(MAX_LIMIT) }).limit).toBe(
      MAX_LIMIT,
    );
  });
});

describe('buildPage', () => {
  it('con una fila de sobra, recorta y devuelve el cursor de la siguiente', () => {
    // Se consultan limit + 1 filas: la de sobra dice si hay mas paginas, sin
    // tener que contar el total.
    const page = buildPage(rows, 3, SORT, toPosition);

    expect(page.data).toHaveLength(3);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();

    // El cursor apunta a la ultima fila devuelta, no a la de sobra.
    expect(decodeCursor(page.page.nextCursor!, SORT)).toEqual(toPosition(rows[2]!));
  });

  it('en la ultima pagina nextCursor es null', () => {
    const page = buildPage(rows.slice(0, 2), 3, SORT, toPosition);

    expect(page.data).toHaveLength(2);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });

  it('con una lista vacia no devuelve cursor', () => {
    const page = buildPage([], 25, SORT, toPosition);

    expect(page.data).toEqual([]);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });

  it('no devuelve `total`: contar filas en tablas grandes cuesta', () => {
    const page = buildPage(rows, 3, SORT, toPosition);

    expect(page.page).not.toHaveProperty('total');
    expect(Object.keys(page.page).sort()).toEqual(['hasMore', 'limit', 'nextCursor']);
  });
});
