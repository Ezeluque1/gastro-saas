// Interfaz publica del modulo `platform`.
//
// Puede usar `tenants` y `users`, porque el alta de un local cruza los dos.
// Es el modulo que va a crecer con el panel de plataforma de la fase 8.
export { platformModule, createPlatformModule } from './platform.module.js';
export type { PlatformModule } from './platform.module.js';

export { makeCreateTenant } from './application/create-tenant.js';
export type {
  CreateTenant,
  CreateTenantResult,
  TenantAlreadyExists,
  CreateTenantOutcome,
} from './application/create-tenant.js';

export type { PlatformAuditPort } from './domain/platform-audit.repository.js';
