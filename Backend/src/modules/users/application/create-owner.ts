import type { Tx } from '../../../shared/db/index.js';
import {
  createActivationToken,
  type ActivationToken,
} from '../domain/activation-token.js';
import type { UserRepository } from '../domain/user.repository.js';

/**
 * Caso de uso: crear el primer Dueno del local, con su link de activacion.
 *
 * Queda sin contrasena: la elige al activar, asi el administrador que da de
 * alta el local nunca la conoce. El rol se asigna con alcance total
 * (`branchId` nulo) porque el Dueno administra el local entero.
 *
 * El email NO se marca como verificado: lo verifica el mismo link de
 * activacion, en la fase 1.4. Hasta entonces no puede recuperar su clave por
 * email, y es correcto que sea asi.
 */

export interface CreatedOwner {
  readonly userId: string;
  /** Se muestra una sola vez. En la base solo queda su hash. */
  readonly activationToken: string;
  readonly activationExpiresAt: Date;
}

export function makeCreateOwner(repo: UserRepository) {
  return async function createOwner(
    tx: Tx,
    data: {
      tenantId: string;
      ownerRoleId: string;
      login: string;
      name: string;
      email: string;
    },
    // Se puede inyectar para que una prueba use un token conocido.
    token: ActivationToken = createActivationToken(),
  ): Promise<CreatedOwner> {
    const userId = await repo.createUser(tx, {
      tenantId: data.tenantId,
      login: data.login,
      name: data.name,
      email: data.email,
      activationTokenHash: token.tokenHash,
      activationExpiresAt: token.expiresAt,
    });

    await repo.assignRole(tx, {
      tenantId: data.tenantId,
      userId,
      branchId: null,
      roleId: data.ownerRoleId,
    });

    return {
      userId,
      activationToken: token.token,
      activationExpiresAt: token.expiresAt,
    };
  };
}

export type CreateOwner = ReturnType<typeof makeCreateOwner>;
