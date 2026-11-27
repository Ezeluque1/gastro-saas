import { randomUUID } from 'node:crypto';

import { withTenant } from '../../../shared/db/index.js';
import type { CreateTenantInput, TenantsModule } from '../../tenants/index.js';
import type { UsersModule } from '../../users/index.js';
import type { PlatformAuditPort } from '../domain/platform-audit.repository.js';

/**
 * Caso de uso: dar de alta un local completo.
 *
 * Es el unico caso de uso del sistema que cruza dos modulos, y la razon por la
 * que existe `platform`: la tabla de dependencias no permite que `tenants` use
 * `users`, y poner el alta en `users` seria al reves.
 *
 * Todo en UNA transaccion: local, configuracion, sucursal, caja, medios de
 * pago, los cuatro roles con sus permisos, el Dueno y su asignacion. Si algo
 * falla, no queda nada a medias.
 *
 * docs/Backend: "Plataforma: alta de locales y estado del tenant".
 */

export interface CreateTenantResult {
  readonly tenantId: string;
  readonly slug: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly ownerUserId: string;
  readonly roleIds: Readonly<Record<string, string>>;
  readonly paymentMethods: number;
  readonly permissionRows: number;
  /** Se muestra una sola vez: en la base solo queda su hash. */
  readonly activationToken: string;
  readonly activationExpiresAt: Date;
  readonly alreadyExisted: false;
}

export interface TenantAlreadyExists {
  readonly slug: string;
  readonly tenantId: string;
  readonly alreadyExisted: true;
}

export type CreateTenantOutcome = CreateTenantResult | TenantAlreadyExists;

export function makeCreateTenant(deps: {
  tenants: TenantsModule;
  users: UsersModule;
  audit: PlatformAuditPort;
}) {
  return async function createTenant(
    input: CreateTenantInput,
  ): Promise<CreateTenantOutcome> {
    // Idempotente por slug. Se pregunta con la funcion SECURITY DEFINER, que es
    // la unica forma de consultar por un slug sin tener contexto de tenant. Si
    // igual hubiera una carrera, la restriccion unica de `tenants.slug` la
    // corta y la transaccion se revierte completa.
    const existing = await deps.tenants.resolveTenantBySlug(input.slug);

    if (existing !== null) {
      return { slug: input.slug, tenantId: existing.id, alreadyExisted: true };
    }

    const tenantId = randomUUID();

    // El contexto se fija con el id NUEVO antes de insertar: lo exige el WITH
    // CHECK de la politica de `tenants`, cuya condicion compara `id`. Es
    // incomodo a proposito y es lo que evita darle BYPASSRLS a la aplicacion.
    return withTenant(tenantId, async (tx) => {
      const core = await deps.tenants.createTenantCore(tx, tenantId, input);
      const roles = await deps.users.createBaseRoles(tx, tenantId);

      const owner = await deps.users.createOwner(tx, {
        tenantId,
        ownerRoleId: roles.byKey.owner,
        login: input.ownerLogin,
        name: input.ownerName,
        email: input.ownerEmail,
      });

      // Dentro de la misma transaccion: si el alta se revierte, el registro
      // tambien.
      await deps.audit.log(tx, {
        action: 'create_tenant',
        tenantId,
        detail: {
          slug: input.slug,
          name: input.name,
          branchId: core.branchId,
          ownerUserId: owner.userId,
          // Los topes quedan registrados: si manana el Dueno dice que nunca se
          // los cargaron, hay con que responder.
          egressLimitAmount: input.egressLimitAmount,
          egressShiftLimitAmount: input.egressShiftLimitAmount,
        },
      });

      return {
        tenantId,
        slug: input.slug,
        branchId: core.branchId,
        cashRegisterId: core.cashRegisterId,
        ownerUserId: owner.userId,
        roleIds: roles.byKey,
        paymentMethods: core.paymentMethods,
        permissionRows: roles.permissionRows,
        activationToken: owner.activationToken,
        activationExpiresAt: owner.activationExpiresAt,
        alreadyExisted: false,
      };
    });
  };
}

export type CreateTenant = ReturnType<typeof makeCreateTenant>;
