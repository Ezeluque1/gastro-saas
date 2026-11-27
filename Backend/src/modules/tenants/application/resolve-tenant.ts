import type { ResolvedTenant } from '../domain/tenant.js';
import type { TenantResolverPort } from '../domain/tenant.repository.js';

/**
 * Caso de uso: resolver el slug de la URL al local.
 *
 * Es la primera cosa que hace todo login, cuando todavia no se sabe a que local
 * pertenece la request.
 *
 * Devuelve `null` si el local no existe, sin distinguir de ningun otro caso: el
 * login responde el mismo error para local inexistente, usuario inexistente y
 * clave incorrecta, asi no se pueden enumerar los locales de la plataforma.
 */
export function makeResolveTenantBySlug(resolver: TenantResolverPort) {
  return async function resolveTenantBySlug(
    slug: string,
  ): Promise<ResolvedTenant | null> {
    return resolver.resolveBySlug(slug);
  };
}

export type ResolveTenantBySlug = ReturnType<typeof makeResolveTenantBySlug>;
