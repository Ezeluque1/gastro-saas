import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { config } from './config/index.js';
import { healthModule } from './modules/health/index.js';
import {
  errorHandler,
  generalRateLimit,
  jsonOnly,
  notFoundHandler,
  requestContext,
} from './shared/http/index.js';
import { logger } from './shared/logger/index.js';

/**
 * Arma la aplicacion Express y registra middlewares y modulos.
 *
 * El orden importa y sigue el "Ciclo de una request" del documento. Lo que no
 * se puede mover:
 *
 *  - requestContext() va PRIMERO, para que todo lo demas (incluido un error en
 *    el parseo del cuerpo) tenga un requestId con el que responder.
 *  - El manejador de errores va ULTIMO.
 *
 * Los middlewares de sesion, tenant y permisos entran en las Fases 1 y 2, entre
 * el rate limit y las rutas de los modulos.
 */
export interface AppOptions {
  /**
   * Routers que se montan en el punto donde van los modulos de negocio, antes
   * del 404 y del manejador de errores.
   *
   * Es por donde entran los modulos desde la Fase 1, y es lo que usan las
   * pruebas para montar rutas que ejercitan el pipeline (un error inesperado,
   * una validacion) sin tocar la aplicacion real.
   */
  readonly routers?: readonly Router[];
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  // Detras de un proxy (Caddy, el hosting) para que la IP del cliente que ve
  // el rate limit sea la real y no la del proxy.
  app.set('trust proxy', config.isProduction ? 1 : false);

  // No anunciar que el servidor es Express.
  app.disable('x-powered-by');

  // Las rutas /l/{slug}/... distinguen mayusculas y el slug es siempre
  // minusculo: que /L/Demo no sea la misma ruta que /l/demo.
  app.set('case sensitive routing', true);
  app.set('strict routing', false);

  // 1. Id de request: va en X-Request-Id, en el log y en el cuerpo del error.
  app.use(requestContext());

  // 2. Logs estructurados en JSON, con el id de la request en cada linea.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId ?? 'unknown',
      // /health lo consulta el monitor cada pocos segundos: no ensuciar el log.
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) => {
        if (err !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // 3. Cabeceras seguras con CSP restrictiva.
  //    Sin CORS a proposito: el servidor nunca manda Access-Control-Allow-Origin,
  //    asi que ningun otro origen puede leer respuestas ni mandar JSON.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // La API no se embebe en ningun lado.
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // 4. Freno general por IP.
  app.use(generalRateLimit());

  // 5. Health check: antes del jsonOnly y del parseo, porque es un GET y no
  //    debe depender de nada que pueda fallar.
  app.use(healthModule.routes);

  // 6. Solo JSON en las escrituras (parte de la defensa contra CSRF) y limite
  //    de cuerpo.
  app.use(jsonOnly());
  app.use(express.json({ limit: config.BODY_LIMIT }));

  // 7. Modulos de negocio. Entran desde la Fase 1, bajo /l/{slug}/api/v1.
  for (const router of options.routers ?? []) {
    app.use(router);
  }

  // 8. Ruta inexistente: sale como problem+json, no como el HTML de Express.
  app.use(notFoundHandler());

  // 9. Manejador central de errores. Siempre el ultimo.
  app.use(errorHandler());

  return app;
}
