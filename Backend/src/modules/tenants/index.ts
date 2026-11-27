// Interfaz publica del modulo `tenants`.
//
// Los demas modulos importan SOLO desde aca, nunca de api/, application/,
// domain/ ni infrastructure/. Una regla de ESLint lo hace cumplir.
export { tenantsModule, createTenantsModule } from './tenants.module.js';
export type { TenantsModule } from './tenants.module.js';

export { createTenantSchema, slugSchema } from './api/tenants.schemas.js';
export type { CreateTenantInput } from './api/tenants.schemas.js';

export {
  RESERVED_SLUGS,
  checkSlug,
  INITIAL_TENANT_STATUS,
  DEFAULT_TIMEZONE,
  DEFAULT_BUSINESS_DAY_CUTOFF,
} from './domain/tenant.js';
export type {
  ResolvedTenant,
  TenantStatus,
  NewTenant,
  SlugProblem,
} from './domain/tenant.js';

export type { CreatedTenantParts } from './application/create-tenant-core.js';
