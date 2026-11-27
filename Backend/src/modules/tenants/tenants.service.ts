import { withoutTenant, type Tx } from '../../shared/db/index.js';

import * as repo from './tenants.repository.js';
import type { CreateTenantInput } from './tenants.schemas.js';

/**
 * Casos de uso del modulo `tenants`.
 *
 * docs/Backend: "Login y consultas fuera de RLS" y "Alta de locales".
 */

/** Estado del local. Decide quien puede entrar y que puede hacer. */
export type TenantStatus = 'pilot' | 'active' | 'past_due' | 'suspended' | 'cancelled';

export interface ResolvedTenant {
  readonly id: string;
  readonly status: TenantStatus;
}

/**
 * Resuelve el slug de la URL al local.
 *
 * Es la unica consulta del login que corre fuera de RLS, porque pasa antes de
 * saber a que local pertenece la request. Va por la funcion
 * `resolve_tenant_by_slug`, que es SECURITY DEFINER y devuelve solo el id y el
 * estado.
 *
 * Devuelve `null` si el local no existe, sin distinguir de ningun otro caso:
 * el login responde el mismo error para local inexistente, usuario inexistente
 * y clave incorrecta, asi no se pueden enumerar los locales de la plataforma.
 *
 * Cada llamada queda registrada en `platform_audit_log`, incluidas las que no
 * encuentran nada: eso es lo que deja rastro de alguien probando nombres.
 */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const rows = await withoutTenant(
    'resolve_tenant_by_slug',
    async (tx) =>
      tx.$queryRaw<{ id: string; status: TenantStatus }[]>`
      SELECT id, status FROM resolve_tenant_by_slug(${slug})
    `,
  );

  return rows[0] ?? null;
}

export interface CreatedTenantParts {
  readonly tenantId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly paymentMethods: number;
}

/**
 * Crea el local, su configuracion, la primera sucursal, su caja y los medios de
 * pago por defecto.
 *
 * Recibe el `tenantId` ya generado y la transaccion ya abierta con ese id como
 * contexto: no abre transaccion propia. Quien orquesta el alta completa es el
 * modulo `platform`, que suma los roles y el Dueno dentro de la MISMA
 * transaccion.
 *
 * No valida si el slug ya existe: eso lo chequea `platform` antes de empezar,
 * con la funcion SECURITY DEFINER. Si igual hubiera una carrera, la restriccion
 * unica de `tenants.slug` la corta.
 */
export async function createTenantCore(
  tx: Tx,
  tenantId: string,
  input: CreateTenantInput,
): Promise<CreatedTenantParts> {
  const planId = await repo.findBasePlanId(tx);

  if (planId === null) {
    throw new Error(
      'No hay un plan Base activo. Aplica las migraciones antes de dar de alta un local.',
    );
  }

  await repo.insertTenant(tx, {
    id: tenantId,
    name: input.name,
    slug: input.slug,
    planId,
  });

  await repo.insertTenantSettings(tx, {
    tenantId,
    timezone: input.timezone,
    businessDayCutoff: input.businessDayCutoff,
    egressLimitAmount: input.egressLimitAmount,
    egressShiftLimitAmount: input.egressShiftLimitAmount,
  });

  const branchId = await repo.insertBranch(tx, {
    tenantId,
    name: input.branchName,
  });

  // Toda sucursal arranca con una caja: sin caja no se puede cobrar, y el
  // documento pide crearla en el alta para que el local pueda operar el primer
  // dia sin configurar nada.
  const cashRegisterId = await repo.insertCashRegister(tx, {
    tenantId,
    branchId,
    name: 'Caja 1',
  });

  const paymentMethods = await repo.insertDefaultPaymentMethods(tx, tenantId);

  return { tenantId, branchId, cashRegisterId, paymentMethods };
}
