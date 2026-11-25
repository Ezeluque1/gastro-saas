import { describe, expect, it } from 'vitest';

import {
  BusinessRuleError,
  InvalidCredentialsError,
  PermissionDeniedError,
  ValidationError,
  VersionConflictError,
} from '../../src/shared/errors/index.js';
import { toProblem } from '../../src/shared/errors/problem.js';

const REQUEST_ID = 'b7e1c0f2-5d1a-4c1e-9d3e-0f6a2b7c9a10';

describe('toProblem', () => {
  it('serializa un AppError con los miembros del contrato', () => {
    const problem = toProblem(new VersionConflictError(7), REQUEST_ID);

    expect(problem).toMatchObject({
      type: '/errors/version_conflict',
      status: 409,
      code: 'version_conflict',
      requestId: REQUEST_ID,
      currentVersion: 7,
    });
    expect(problem.title).toBeTypeOf('string');
    expect(problem.detail).toBeTypeOf('string');
  });

  it('expone `errors` con el JSON Pointer del campo invalido', () => {
    const problem = toProblem(
      new ValidationError([
        { pointer: '/items/0/quantity', code: 'too_small', detail: 'Debe ser mayor a 0' },
      ]),
      REQUEST_ID,
    );

    expect(problem.status).toBe(400);
    expect(problem.code).toBe('validation_error');
    expect(problem['errors']).toEqual([
      { pointer: '/items/0/quantity', code: 'too_small', detail: 'Debe ser mayor a 0' },
    ]);
  });

  it('lleva el permiso y el tope cuando se supera un tope', () => {
    // Un descuento sobre el tope NO tiene codigo propio: responde
    // permission_denied con el permiso y el tope vigente.
    const problem = toProblem(
      new PermissionDeniedError({
        permission: 'orders.discount_over_limit',
        limit: '10.00',
      }),
      REQUEST_ID,
    );

    expect(problem).toMatchObject({
      status: 403,
      code: 'permission_denied',
      permission: 'orders.discount_over_limit',
      limit: '10.00',
    });
  });

  it('deja que cada modulo defina su regla de negocio como 422', () => {
    const problem = toProblem(
      new BusinessRuleError({
        code: 'cash_session_closed',
        detail: 'La caja esta cerrada.',
      }),
      REQUEST_ID,
    );

    expect(problem.status).toBe(422);
    expect(problem.code).toBe('cash_session_closed');
    expect(problem.type).toBe('/errors/cash_session_closed');
  });

  it('no deja que `extra` pise los miembros estandar', () => {
    // Si un modulo pasara `status` o `code` en extra por descuido, la respuesta
    // dejaria de coincidir con el estado HTTP real.
    const problem = toProblem(
      new BusinessRuleError({
        code: 'regla_propia',
        detail: 'No se puede.',
        extra: { status: 200, code: 'otro', requestId: 'falso' },
      }),
      REQUEST_ID,
    );

    expect(problem.status).toBe(422);
    expect(problem.code).toBe('regla_propia');
    expect(problem.requestId).toBe(REQUEST_ID);
  });

  it('convierte cualquier error desconocido en 500 sin filtrar detalles', () => {
    const problem = toProblem(
      new Error('select * from users where password = secreto'),
      REQUEST_ID,
    );

    expect(problem.status).toBe(500);
    expect(problem.code).toBe('internal_error');
    expect(problem.requestId).toBe(REQUEST_ID);
    // Nada del error original puede salir en la respuesta.
    expect(JSON.stringify(problem)).not.toContain('secreto');
    expect(JSON.stringify(problem)).not.toContain('select');
    expect(problem['stack']).toBeUndefined();
  });

  it('da el mismo error para local, usuario y clave incorrectos', () => {
    // Es lo que evita que se puedan enumerar locales o cuentas.
    const a = toProblem(new InvalidCredentialsError(), REQUEST_ID);
    const b = toProblem(new InvalidCredentialsError(), REQUEST_ID);

    expect(a.detail).toBe(b.detail);
    expect(a.code).toBe('invalid_credentials');
    expect(a.status).toBe(401);
  });
});
