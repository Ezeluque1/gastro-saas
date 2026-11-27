// Interfaz publica del modulo `tenants`.
//
// Los demas modulos usan solo lo que se exporta aca, nunca el repositorio.
export { resolveTenantBySlug, createTenantCore } from './tenants.service.js';
export type {
  ResolvedTenant,
  TenantStatus,
  CreatedTenantParts,
} from './tenants.service.js';
export { createTenantSchema, slugSchema, RESERVED_SLUGS } from './tenants.schemas.js';
export type { CreateTenantInput } from './tenants.schemas.js';
