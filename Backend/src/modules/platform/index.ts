// Interfaz publica del modulo `platform`.
//
// Puede usar `tenants` y `users`, porque el alta de un local cruza los dos.
// Es el modulo que va a crecer con el panel de plataforma de la fase 8.
export { createTenant, logPlatformAction } from './platform.service.js';
export type {
  CreateTenantResult,
  TenantAlreadyExists,
  CreateTenantOutcome,
} from './platform.service.js';
