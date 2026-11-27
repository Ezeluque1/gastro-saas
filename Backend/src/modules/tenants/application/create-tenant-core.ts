import type { Tx } from '../../../shared/db/index.js';
import type { NewTenant } from '../domain/tenant.js';
import type { TenantRepository } from '../domain/tenant.repository.js';

/**
 * Caso de uso: crear el local y todo lo que necesita para operar el primer dia.
 *
 * Recibe el repositorio como dependencia (un puerto de `domain/`), no lo
 * importa: eso es lo que permite probarlo sin base de datos y lo que mantiene
 * la dependencia apuntando hacia adentro.
 *
 * No abre transaccion propia ni genera el id. Los recibe, porque el alta
 * completa la orquesta el modulo `platform`, que suma los roles y el Dueno
 * dentro de la MISMA transaccion.
 */

export interface CreatedTenantParts {
  readonly tenantId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly paymentMethods: number;
}

export function makeCreateTenantCore(repo: TenantRepository) {
  return async function createTenantCore(
    tx: Tx,
    tenantId: string,
    input: NewTenant,
  ): Promise<CreatedTenantParts> {
    const planId = await repo.findBasePlanId(tx);

    if (planId === null) {
      throw new Error(
        'No hay un plan Base activo. Aplica las migraciones antes de dar de alta un local.',
      );
    }

    await repo.createTenant(tx, {
      id: tenantId,
      name: input.name,
      slug: input.slug,
      planId,
    });

    await repo.createSettings(tx, {
      tenantId,
      timezone: input.timezone,
      businessDayCutoff: input.businessDayCutoff,
      egressLimitAmount: input.egressLimitAmount,
      egressShiftLimitAmount: input.egressShiftLimitAmount,
    });

    const branchId = await repo.createBranch(tx, { tenantId, name: input.branchName });

    // Toda sucursal arranca con una caja: sin caja no se puede cobrar, y el
    // local tiene que poder operar el primer dia sin configurar nada.
    const cashRegisterId = await repo.createCashRegister(tx, {
      tenantId,
      branchId,
      name: 'Caja 1',
    });

    const paymentMethods = await repo.createDefaultPaymentMethods(tx, tenantId);

    return { tenantId, branchId, cashRegisterId, paymentMethods };
  };
}

export type CreateTenantCore = ReturnType<typeof makeCreateTenantCore>;
