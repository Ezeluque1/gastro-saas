import type { Tx } from '../../../shared/db/index.js';

import type { Permission, RoleTemplateKey } from './permissions.js';

/**
 * Puertos del modulo `users`: las INTERFACES, no las implementaciones.
 *
 * Viven en `domain/` para que `application/` dependa de una interfaz y no de
 * Prisma.
 */
export interface UserRepository {
  /** Devuelve el id del rol creado. */
  createRole(
    tx: Tx,
    data: {
      tenantId: string;
      name: string;
      isSystem: boolean;
      templateKey: RoleTemplateKey | null;
    },
  ): Promise<string>;

  /** Devuelve cuantas filas de permisos se escribieron. */
  grantPermissions(
    tx: Tx,
    data: { tenantId: string; roleId: string; permissions: readonly Permission[] },
  ): Promise<number>;

  /** Devuelve el id del usuario creado. */
  createUser(
    tx: Tx,
    data: {
      tenantId: string;
      login: string;
      name: string;
      email: string | null;
      activationTokenHash: string | null;
      activationExpiresAt: Date | null;
    },
  ): Promise<string>;

  /** `branchId` nulo significa "el mismo rol en todas las sucursales". */
  assignRole(
    tx: Tx,
    data: { tenantId: string; userId: string; branchId: string | null; roleId: string },
  ): Promise<void>;
}
