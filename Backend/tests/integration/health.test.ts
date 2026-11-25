import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { disconnectDatabase } from '../../src/shared/db/index.js';

/**
 * GET /health es la ruta que mira el monitor de uptime. Lo que importa es que
 * distinga de verdad una base que responde de una que no: un /health que
 * devuelve 200 siempre no sirve para nada.
 *
 * docs/Backend: "Monitoreo" (Uptime) y "Backups y observabilidad".
 */

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('GET /health', () => {
  it('responde 200 con la base arriba', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('no se cachea: el monitor tiene que ver el estado de ahora', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('queda fuera del versionado y del path del local', async () => {
    // El monitor no tiene sesion ni conoce ningun slug.
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });
});
