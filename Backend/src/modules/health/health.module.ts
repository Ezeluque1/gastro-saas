import type { Router } from 'express';

import { healthRoutes } from './api/health.routes.js';

/**
 * Configuracion del modulo `health`.
 *
 * No tiene application/, domain/ ni infrastructure/: es una sola ruta que
 * pregunta a la base si responde, y no hay regla de negocio que separar.
 * Las carpetas se crean cuando hagan falta; inventarlas vacias no aporta nada
 * (y git no las conservaria igual).
 */
export interface HealthModule {
  readonly routes: Router;
}

export function createHealthModule(): HealthModule {
  return { routes: healthRoutes() };
}

export const healthModule = createHealthModule();
