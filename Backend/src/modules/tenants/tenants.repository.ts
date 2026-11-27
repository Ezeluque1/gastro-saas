import { randomUUID } from 'node:crypto';

import type { Tx } from '../../shared/db/index.js';

/**
 * Consultas sobre las tablas del modulo `tenants`.
 *
 * Siempre con la transaccion recibida: nunca abre una propia, para que el alta
 * de un local se confirme o se revierta completa.
 *
 * docs/Backend: "Capas dentro de cada modulo".
 */

export interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
}

/** Medios de pago que trae todo local nuevo. */
const DEFAULT_PAYMENT_METHODS = [
  { name: 'Efectivo', type: 'cash' },
  { name: 'Tarjeta', type: 'card' },
  { name: 'Transferencia', type: 'transfer' },
  { name: 'Billetera virtual', type: 'wallet' },
] as const;

/**
 * Inserta el local.
 *
 * Quien llame tiene que haber fijado `app.tenant_id` con este mismo `id`: el
 * WITH CHECK de la politica de `tenants` lo exige, porque su politica compara
 * `id` y no `tenant_id`. Es incomodo a proposito, y es lo que evita tener que
 * darle BYPASSRLS a la aplicacion para dar de alta un local.
 */
export async function insertTenant(
  tx: Tx,
  data: { id: string; name: string; slug: string; planId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO tenants (id, name, slug, plan_id, status, updated_at)
    VALUES (${data.id}::uuid, ${data.name}, ${data.slug}, ${data.planId}::uuid, 'pilot', now())
  `;
}

/**
 * Crea la configuracion del local.
 *
 * El tope de descuento queda en su valor por defecto (10%) y los dos topes en
 * pesos en lo que se haya cargado, que puede ser 0.
 */
export async function insertTenantSettings(
  tx: Tx,
  data: {
    tenantId: string;
    timezone: string;
    businessDayCutoff: string;
    egressLimitAmount: number;
    egressShiftLimitAmount: number;
  },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO tenant_settings (
      id, tenant_id, timezone, business_day_cutoff,
      egress_limit_amount, egress_shift_limit_amount, updated_at
    )
    VALUES (
      ${randomUUID()}::uuid, ${data.tenantId}::uuid, ${data.timezone}, ${data.businessDayCutoff},
      ${data.egressLimitAmount}, ${data.egressShiftLimitAmount}, now()
    )
  `;
}

/** Crea una sucursal y devuelve su id. */
export async function insertBranch(
  tx: Tx,
  data: { tenantId: string; name: string },
): Promise<string> {
  const id = randomUUID();

  await tx.$executeRaw`
    INSERT INTO branches (id, tenant_id, name, updated_at)
    VALUES (${id}::uuid, ${data.tenantId}::uuid, ${data.name}, now())
  `;

  return id;
}

/** Crea la caja de una sucursal y devuelve su id. */
export async function insertCashRegister(
  tx: Tx,
  data: { tenantId: string; branchId: string; name: string },
): Promise<string> {
  const id = randomUUID();

  await tx.$executeRaw`
    INSERT INTO cash_registers (id, tenant_id, branch_id, name, updated_at)
    VALUES (${id}::uuid, ${data.tenantId}::uuid, ${data.branchId}::uuid, ${data.name}, now())
  `;

  return id;
}

/**
 * Crea los medios de pago por defecto.
 *
 * Se crean los cuatro tipos y el Dueno desactiva los que no use. Es mas simple
 * que preguntarselo en el alta, y la baja conserva los pagos historicos.
 */
export async function insertDefaultPaymentMethods(
  tx: Tx,
  tenantId: string,
): Promise<number> {
  for (const method of DEFAULT_PAYMENT_METHODS) {
    await tx.$executeRaw`
      INSERT INTO payment_methods (id, tenant_id, name, type, updated_at)
      VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${method.name},
              ${method.type}::payment_method_type, now())
    `;
  }

  return DEFAULT_PAYMENT_METHODS.length;
}

/**
 * Id del plan base.
 *
 * `plans` no tiene tenant_id ni RLS: es configuracion de plataforma. La fila la
 * siembra la migracion `plan_base`, porque sin un plan no se puede dar de alta
 * ningun local.
 */
export async function findBasePlanId(tx: Tx): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM plans WHERE name = 'Base' AND active = true LIMIT 1
  `;

  return rows[0]?.id ?? null;
}
