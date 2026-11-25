import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * GET /health con la base caida.
 *
 * Va en un archivo aparte porque la caida se simula reemplazando el modulo de
 * base entero: con imports ESM no se puede espiar una funcion importada por
 * nombre, y mezclarlo con las pruebas del camino feliz las dejaria mockeadas.
 *
 * Importa que esto este cubierto: un /health que responde 200 siempre no
 * dispara ninguna alerta, y es justo la alerta lo que se quiere.
 */
vi.mock('../../src/shared/db/index.js', async () => {
  // Sin tipo explicito: vi.mock se eleva por encima de los imports, asi que el
  // tipo del modulo no se puede importar arriba, y una anotacion `import()`
  // aca la rechaza el linter.
  const actual = await vi.importActual('../../src/shared/db/index.js');

  const { ServiceUnavailableError } = await import('../../src/shared/errors/index.js');

  return {
    ...actual,
    checkDatabase: vi
      .fn()
      .mockRejectedValue(
        new ServiceUnavailableError('No se pudo conectar con la base de datos.'),
      ),
  };
});

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

describe('GET /health con la base caida', () => {
  it('responde 503 service_unavailable en problem+json', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: '/errors/service_unavailable',
      status: 503,
      code: 'service_unavailable',
    });
    expect(res.body.requestId).toBeTypeOf('string');
  });
});
