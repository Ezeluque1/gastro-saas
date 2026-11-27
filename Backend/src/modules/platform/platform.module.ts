import { tenantsModule } from '../tenants/index.js';
import { usersModule } from '../users/index.js';

import { makeCreateTenant, type CreateTenant } from './application/create-tenant.js';
import type { PlatformAuditPort } from './domain/platform-audit.repository.js';
import { sqlPlatformAudit } from './infrastructure/sql-platform-audit.repository.js';

/**
 * Configuracion del modulo `platform`.
 *
 * Es el unico modulo que depende de otros dos (`tenants` y `users`), y los usa
 * por su interfaz publica. Aca se ve la composicion completa del alta.
 */
export interface PlatformModule {
  readonly createTenant: CreateTenant;
  readonly audit: PlatformAuditPort;
}

export function createPlatformModule(): PlatformModule {
  return {
    createTenant: makeCreateTenant({
      tenants: tenantsModule,
      users: usersModule,
      audit: sqlPlatformAudit,
    }),
    audit: sqlPlatformAudit,
  };
}

export const platformModule = createPlatformModule();
