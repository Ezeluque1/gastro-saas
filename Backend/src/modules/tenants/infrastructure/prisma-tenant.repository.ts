import type { Tx } from '../../../shared/db/index.js';
import type { TenantRepository } from '../domain/tenant.repository.js';
import { INITIAL_TENANT_STATUS } from '../domain/tenant.js';

/**
 * Implementacion de `TenantRepository` con Prisma Client.
 *
 * Usa el cliente tipado y no SQL crudo. El documento reserva el SQL crudo para
 * donde hace falta atomicidad (descuento de stock, numeracion de pedidos), y
 * acá no es el caso.
 *
 * La diferencia no es estetica:
 *
 *  - `updated_at` es NOT NULL y SIN default en la base. Con el cliente tipado
 *    lo pone `@updatedAt`; con SQL crudo habia que escribir `now()` a mano en
 *    cada insert, y el que se olvidara fallaba en ejecucion.
 *  - Si una columna se renombra en el esquema, esto rompe en `tsc` y no en
 *    produccion.
 *  - No hacen falta los casts `::uuid` a mano.
 */

/** Medios de pago que trae todo local nuevo. */
const DEFAULT_PAYMENT_METHODS = [
  { name: 'Efectivo', type: 'cash' },
  { name: 'Tarjeta', type: 'card' },
  { name: 'Transferencia', type: 'transfer' },
  { name: 'Billetera virtual', type: 'wallet' },
] as const;

export const prismaTenantRepository: TenantRepository = {
  async findBasePlanId(tx: Tx): Promise<string | null> {
    // `plans` no tiene tenant_id ni RLS: es configuracion de plataforma. La
    // fila la siembra la migracion `plan_base`.
    const plan = await tx.plan.findFirst({
      where: { name: 'Base', active: true },
      select: { id: true },
    });

    return plan?.id ?? null;
  },

  async createTenant(tx, data): Promise<void> {
    // Quien llame tiene que haber fijado `app.tenant_id` con este mismo id: el
    // WITH CHECK de la politica de `tenants` lo exige, porque su condicion
    // compara `id` y no `tenant_id`. Prisma hace INSERT ... RETURNING, y el
    // RETURNING tambien necesita que la fila sea visible para la politica.
    await tx.tenant.create({
      data: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        planId: data.planId,
        status: INITIAL_TENANT_STATUS,
      },
      select: { id: true },
    });
  },

  async createSettings(tx, data): Promise<void> {
    // El tope de descuento queda en su default (10%). Los dos topes en pesos
    // van como se cargaron, que puede ser 0.
    await tx.tenantSettings.create({
      data: {
        tenantId: data.tenantId,
        timezone: data.timezone,
        businessDayCutoff: data.businessDayCutoff,
        egressLimitAmount: data.egressLimitAmount,
        egressShiftLimitAmount: data.egressShiftLimitAmount,
      },
      select: { id: true },
    });
  },

  async createBranch(tx, data): Promise<string> {
    const branch = await tx.branch.create({
      data: { tenantId: data.tenantId, name: data.name },
      select: { id: true },
    });

    return branch.id;
  },

  async createCashRegister(tx, data): Promise<string> {
    const register = await tx.cashRegister.create({
      data: { tenantId: data.tenantId, branchId: data.branchId, name: data.name },
      select: { id: true },
    });

    return register.id;
  },

  async createDefaultPaymentMethods(tx, tenantId): Promise<number> {
    // createMany en una sola ida a la base. No necesita RETURNING, asi que no
    // choca con la politica.
    const { count } = await tx.paymentMethod.createMany({
      data: DEFAULT_PAYMENT_METHODS.map((method) => ({
        tenantId,
        name: method.name,
        type: method.type,
      })),
    });

    return count;
  },
};
