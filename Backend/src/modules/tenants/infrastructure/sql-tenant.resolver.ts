import { withoutTenant } from '../../../shared/db/index.js';
import type { ResolvedTenant, TenantStatus } from '../domain/tenant.js';
import type { TenantResolverPort } from '../domain/tenant.repository.js';

/**
 * Implementacion de `TenantResolverPort`.
 *
 * Es el unico lugar del modulo donde se usa SQL crudo, y la razon no es
 * atomicidad sino que no hay otra forma: llama a la funcion
 * `resolve_tenant_by_slug`, que es SECURITY DEFINER, y Prisma Client no modela
 * llamadas a funciones. Es tambien la unica consulta del sistema que corre
 * fuera de RLS.
 *
 * docs/Backend: "Login y consultas fuera de RLS".
 */
export const sqlTenantResolver: TenantResolverPort = {
  async resolveBySlug(slug: string): Promise<ResolvedTenant | null> {
    const rows = await withoutTenant(
      'resolve_tenant_by_slug',
      async (tx) =>
        tx.$queryRaw<{ id: string; status: TenantStatus }[]>`
          SELECT id, status FROM resolve_tenant_by_slug(${slug})
        `,
    );

    return rows[0] ?? null;
  },
};
