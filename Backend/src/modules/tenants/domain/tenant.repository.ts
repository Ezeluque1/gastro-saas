import type { Tx } from '../../../shared/db/index.js';

import type { ResolvedTenant } from './tenant.js';

/**
 * Puertos del modulo `tenants`: las INTERFACES, no las implementaciones.
 *
 * Viven en `domain/` a proposito. Es lo que hace que la dependencia apunte
 * hacia adentro: `application/` depende de estas interfaces, no de Prisma. Si
 * manana una tabla se consulta distinto, cambia `infrastructure/` y el caso de
 * uso no se toca.
 *
 * `Tx` es la unica concesion: el tipo de la transaccion viene de shared/db. Se
 * acepta porque toda la arquitectura se apoya en pasar la transaccion entre
 * capas y modulos, que es lo que garantiza que una operacion se confirme o se
 * revierta junta.
 */

/** Lectura y escritura de las tablas del modulo. */
export interface TenantRepository {
  /** Id del plan base. `null` si no existe, que es un error de instalacion. */
  findBasePlanId(tx: Tx): Promise<string | null>;

  createTenant(
    tx: Tx,
    data: { id: string; name: string; slug: string; planId: string },
  ): Promise<void>;

  createSettings(
    tx: Tx,
    data: {
      tenantId: string;
      timezone: string;
      businessDayCutoff: string;
      egressLimitAmount: number;
      egressShiftLimitAmount: number;
    },
  ): Promise<void>;

  /** Devuelve el id de la sucursal creada. */
  createBranch(tx: Tx, data: { tenantId: string; name: string }): Promise<string>;

  /** Devuelve el id de la caja creada. */
  createCashRegister(
    tx: Tx,
    data: { tenantId: string; branchId: string; name: string },
  ): Promise<string>;

  /** Devuelve cuantos medios de pago se crearon. */
  createDefaultPaymentMethods(tx: Tx, tenantId: string): Promise<number>;
}

/**
 * Resolucion de un slug sin contexto de tenant.
 *
 * Es un puerto aparte porque no es una consulta normal: corre fuera de RLS, por
 * una funcion SECURITY DEFINER, y no recibe `tx` justamente porque abre su
 * propia transaccion sin contexto. Separarlo deja visible que es la excepcion y
 * no una consulta mas.
 */
export interface TenantResolverPort {
  /** `null` si el local no existe, sin distinguir de ninguna otra causa. */
  resolveBySlug(slug: string): Promise<ResolvedTenant | null>;
}
