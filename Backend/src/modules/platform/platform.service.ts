import { randomUUID } from 'node:crypto';

import { withTenant, type Tx } from '../../shared/db/index.js';
import { createTenantCore, resolveTenantBySlug } from '../tenants/index.js';
import type { CreateTenantInput } from '../tenants/index.js';
import { createBaseRoles, createOwner } from '../users/index.js';

/**
 * Modulo `platform`: lo que opera sobre los locales desde afuera de un local.
 *
 * Existe porque el alta cruza dos modulos. La tabla de dependencias dice que
 * `tenants` no puede usar `users`, y poner el alta en `users` seria al reves.
 * `platform` puede usar los dos, y es lo que va a necesitar igual el panel de
 * plataforma de la fase 8.
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
  /** true cuando el local ya existia y no se creo nada. */
  readonly alreadyExisted: false;
}

export interface TenantAlreadyExists {
  readonly slug: string;
  readonly tenantId: string;
  readonly alreadyExisted: true;
}

export type CreateTenantOutcome = CreateTenantResult | TenantAlreadyExists;

/**
 * Da de alta un local completo.
 *
 * Todo en UNA transaccion: local, configuracion, sucursal, caja, medios de
 * pago, los cuatro roles con sus permisos, el Dueno y su asignacion. Si algo
 * falla, no queda nada a medias.
 *
 * **Idempotente por slug.** Si el local ya existe no crea nada y lo informa.
 * Se chequea con `resolveTenantBySlug`, que va por la funcion SECURITY
 * DEFINER: es la unica forma de preguntar por un slug sin tener todavia
 * contexto de tenant. Si igual hubiera una carrera, la restriccion unica de
 * `tenants.slug` la corta y la transaccion entera se revierte.
 *
 * El contexto de tenant se fija con el id NUEVO antes de insertar: lo exige el
 * WITH CHECK de la politica de `tenants`, cuya condicion compara `id`. Es
 * incomodo a proposito y es lo que evita darle BYPASSRLS a la aplicacion.
 */
export async function createTenant(
  input: CreateTenantInput,
): Promise<CreateTenantOutcome> {
  const existing = await resolveTenantBySlug(input.slug);

  if (existing !== null) {
    return { slug: input.slug, tenantId: existing.id, alreadyExisted: true };
  }

  const tenantId = randomUUID();

  return withTenant(tenantId, async (tx) => {
    const core = await createTenantCore(tx, tenantId, input);
    const roles = await createBaseRoles(tx, tenantId);

    const ownerRoleId = roles.byKey.owner;

    const owner = await createOwner(tx, {
      tenantId,
      ownerRoleId,
      login: input.ownerLogin,
      name: input.ownerName,
      email: input.ownerEmail,
    });

    // La auditoria de plataforma va por la funcion SECURITY DEFINER: la
    // aplicacion no tiene permisos sobre esa tabla, y esta bien que no los
    // tenga. Va dentro de la misma transaccion, asi que si el alta se revierte,
    // el registro tambien.
    await logPlatformAction(tx, {
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
}

/**
 * Deja constancia de una accion de plataforma.
 *
 * Va por `log_platform_action`, que es SECURITY DEFINER, porque la aplicacion
 * no tiene ningun permiso sobre `platform_audit_log`: esa tabla registra lo que
 * hace la plataforma, no es de ningun local, y un local no deberia poder
 * escribir ni leer ahi.
 */
export async function logPlatformAction(
  tx: Tx,
  data: {
    action: string;
    tenantId?: string | null;
    adminId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.$executeRaw`
    SELECT log_platform_action(
      ${data.action},
      ${data.tenantId ?? null}::uuid,
      ${data.adminId ?? null}::uuid,
      ${JSON.stringify(data.detail ?? {})}::jsonb
    )
  `;
}
