import type { Express } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { createApp } from '../../src/app.js';
import { validate } from '../../src/shared/http/index.js';

/**
 * Aplicacion real con unas rutas extra que existen solo para ejercitar el
 * pipeline HTTP: un error inesperado, una validacion y una escritura.
 *
 * Entran por el mismo punto de extension que van a usar los modulos de negocio
 * desde la Fase 1, asi que lo que se prueba aca es el pipeline de verdad.
 */
export function createTestApp(): Express {
  const router = Router();

  router.post('/__test/boom', () => {
    throw new Error('fallo a proposito: select * from users where token = secreto');
  });

  router.post('/__test/boom-async', async () => {
    // Con Express 5 una promesa rechazada llega sola al manejador de errores,
    // sin envolver el handler.
    await Promise.resolve();
    throw new Error('fallo asincronico a proposito');
  });

  router.post(
    '/__test/echo',
    validate({
      body: z.strictObject({
        quantity: z.number().int().positive(),
        note: z.string().optional(),
      }),
    }),
    (req, res) => {
      res.status(200).json(req.body);
    },
  );

  router.get(
    '/__test/list',
    validate({ query: z.strictObject({ status: z.string().optional() }) }),
    (req, res) => {
      res.status(200).json({ data: [], query: req.validatedQuery });
    },
  );

  return createApp({ routers: [router] });
}
