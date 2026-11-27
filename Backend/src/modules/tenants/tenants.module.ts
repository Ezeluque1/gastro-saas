import {
  makeCreateTenantCore,
  type CreateTenantCore,
} from './application/create-tenant-core.js';
import {
  makeResolveTenantBySlug,
  type ResolveTenantBySlug,
} from './application/resolve-tenant.js';
import { prismaTenantRepository } from './infrastructure/prisma-tenant.repository.js';
import { sqlTenantResolver } from './infrastructure/sql-tenant.resolver.js';

/**
 * Configuracion del modulo `tenants`.
 *
 * Arma los casos de uso inyectandoles las implementaciones concretas de los
 * puertos. Es el UNICO lugar del modulo donde `application/` y
 * `infrastructure/` se encuentran: los casos de uso solo conocen las
 * interfaces de `domain/`.
 *
 * La composicion es a mano, sin contenedor de inyeccion: con un monolito
 * modular se lee mejor y no agrega una pieza mas que entender.
 */
export interface TenantsModule {
  readonly createTenantCore: CreateTenantCore;
  readonly resolveTenantBySlug: ResolveTenantBySlug;
}

export function createTenantsModule(): TenantsModule {
  return {
    createTenantCore: makeCreateTenantCore(prismaTenantRepository),
    resolveTenantBySlug: makeResolveTenantBySlug(sqlTenantResolver),
  };
}

/** Instancia que usa la aplicacion. Las pruebas pueden armar la suya con dobles. */
export const tenantsModule = createTenantsModule();
