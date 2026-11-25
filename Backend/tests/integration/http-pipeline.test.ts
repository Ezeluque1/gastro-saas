import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER } from '../../src/shared/http/index.js';
import { createTestApp } from '../helpers/test-app.js';

/**
 * El pipeline HTTP contra la aplicacion real.
 *
 * Lo que se verifica es el contrato de la API: que todo error salga en
 * `application/problem+json` con su codigo estable, que el `X-Request-Id` este
 * en toda respuesta y que no se filtren detalles internos.
 *
 * docs/Backend: "Formato de errores", "Cabeceras" y "Proteccion CSRF".
 */

let app: Express;

beforeAll(() => {
  app = createTestApp();
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('X-Request-Id', () => {
  it('va en toda respuesta, tambien en las exitosas', async () => {
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'application/json')
      .send({ quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(UUID_V4);
  });

  it('coincide con el requestId del cuerpo del error', async () => {
    const res = await request(app).get('/no-existe');

    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(res.body.requestId);
  });

  it('cambia en cada pedido', async () => {
    const a = await request(app).get('/no-existe');
    const b = await request(app).get('/no-existe');

    expect(a.body.requestId).not.toBe(b.body.requestId);
  });

  it('lo genera el servidor y no acepta el que mande el cliente', async () => {
    // Si se aceptara, cualquiera podria ensuciar o confundir los logs.
    const inyectado = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const res = await request(app).get('/no-existe').set(REQUEST_ID_HEADER, inyectado);

    expect(res.body.requestId).not.toBe(inyectado);
    expect(res.body.requestId).toMatch(UUID_V4);
  });
});

describe('formato de errores', () => {
  it('una ruta inexistente da 404 en problem+json, no el HTML de Express', async () => {
    const res = await request(app).get('/no-existe');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: '/errors/not_found',
      status: 404,
      code: 'not_found',
    });
    expect(res.body.title).toBeTypeOf('string');
    expect(res.body.detail).toBeTypeOf('string');
  });

  it('un error inesperado da 500 sin filtrar nada interno', async () => {
    const res = await request(app)
      .post('/__test/boom')
      .set('Content-Type', 'application/json')
      .send({});

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('internal_error');
    expect(res.body.requestId).toMatch(UUID_V4);

    // Ni el mensaje original, ni el SQL, ni el stack.
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toContain('secreto');
    expect(cuerpo).not.toContain('select');
    expect(cuerpo).not.toContain('a proposito');
    expect(res.body.stack).toBeUndefined();
  });

  it('una promesa rechazada en un handler async llega al manejador central', async () => {
    // Es lo que Express 5 resuelve solo: sin esto habria que envolver cada
    // handler async, y el que se olvidara colgaria la request.
    const res = await request(app)
      .post('/__test/boom-async')
      .set('Content-Type', 'application/json')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('internal_error');
  });

  it('`type` repite el codigo como URI relativa', async () => {
    const res = await request(app).get('/no-existe');

    expect(res.body.type).toBe(`/errors/${String(res.body.code)}`);
  });
});

describe('validacion', () => {
  it('informa todos los campos invalidos juntos, no solo el primero', async () => {
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'application/json')
      .send({ quantity: -1, note: 123 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.errors).toHaveLength(2);
  });

  it('senala el campo con un JSON Pointer', async () => {
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'application/json')
      .send({ quantity: 0 });

    expect(res.body.errors[0]).toMatchObject({ pointer: '/quantity' });
    expect(res.body.errors[0].code).toBeTypeOf('string');
    expect(res.body.errors[0].detail).toBeTypeOf('string');
  });

  it('un campo desconocido en el cuerpo da 400', async () => {
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'application/json')
      .send({ quantity: 1, cantidadd: 5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('un parametro desconocido en la query da 400', async () => {
    // Un `staus=received` con un error de tipeo no puede devolver todos los
    // pedidos sin avisar.
    const res = await request(app).get('/__test/list?staus=received');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.errors[0]).toHaveProperty('parameter');
  });

  it('un cuerpo que no es JSON valido da 400, no 500', async () => {
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'application/json')
      .send('{roto');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });
});

describe('tipo de contenido y tamano', () => {
  it('una escritura con cuerpo sin Content-Type: application/json da 415', async () => {
    // Parte de la defensa contra CSRF: un formulario de otro sitio no puede
    // mandar application/json sin un preflight de CORS.
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'text/plain')
      .send('quantity=1');

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('un formulario clasico tambien da 415', async () => {
    const res = await request(app)
      .post('/__test/echo')
      .type('form')
      .send({ quantity: '1' });

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('un GET no necesita Content-Type', async () => {
    const res = await request(app).get('/__test/list');

    expect(res.status).toBe(200);
  });

  it('un cuerpo sobre el limite da 413', async () => {
    const grande = { quantity: 1, note: 'x'.repeat(200_000) };
    const res = await request(app)
      .post('/__test/echo')
      .set('Content-Type', 'application/json')
      .send(grande);

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });
});

describe('cabeceras de seguridad', () => {
  it('no manda Access-Control-Allow-Origin: no hay CORS', async () => {
    const res = await request(app).get('/__test/list').set('Origin', 'https://otro.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('no anuncia que el servidor es Express', async () => {
    const res = await request(app).get('/__test/list');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('manda una CSP restrictiva', async () => {
    const res = await request(app).get('/__test/list');

    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
