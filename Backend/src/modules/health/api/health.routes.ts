import { Router } from 'express';

import { checkDatabase } from '../../../shared/db/index.js';
import { ServiceUnavailableError } from '../../../shared/errors/index.js';

/**
 * GET /health
 *
 * Queda FUERA del versionado y fuera del path del local: es la ruta que mira
 * el monitor de uptime, que no tiene sesion ni conoce ningun slug.
 *
 * Hace una consulta simple a la base y responde 200 solo si la conexion
 * funciona. Si la base no responde da 503 `service_unavailable`, que es lo que
 * dispara la alerta.
 *
 * docs/Backend: "Convenciones y versionado" (Fuera del versionado),
 * "Backups y observabilidad" y "Monitoreo" (Uptime).
 */
export function healthRoutes(): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await checkDatabase();
    } catch (error) {
      throw error instanceof ServiceUnavailableError
        ? error
        : new ServiceUnavailableError('No se pudo conectar con la base de datos.');
    }

    // Sin cache: un monitor tiene que ver el estado de ahora, no el de antes.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  return router;
}
