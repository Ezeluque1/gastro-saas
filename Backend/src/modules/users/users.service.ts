import type { Tx } from '../../shared/db/index.js';

import { createActivationToken, type ActivationToken } from './activation-token.js';
import { ROLE_TEMPLATES, type RoleTemplateKey } from './permissions.js';
import * as repo from './users.repository.js';

/**
 * Casos de uso del modulo `users`.
 *
 * docs/Backend: "Permisos por defecto de cada rol" y "Alta de locales".
 */

export interface CreatedRoles {
  /** Id de cada rol creado, por su clave de plantilla. */
  readonly byKey: Readonly<Record<RoleTemplateKey, string>>;
  /** Cuantas filas de permisos se escribieron en total. */
  readonly permissionRows: number;
}

/**
 * Crea los cuatro roles base del local, copiados de la plantilla.
 *
 * El Dueno se crea SIN filas en `role_permissions`: sus permisos se calculan en
 * el codigo a partir de `template_key = 'owner'`. Es deliberado — asi un
 * permiso nuevo del catalogo le llega solo, sin migrar datos y sin riesgo de
 * que un local quede con un Dueno al que le falta algo.
 *
 * Cambiar la plantilla despues NO modifica los roles de los locales ya
 * creados: para eso va una migracion.
 */
export async function createBaseRoles(tx: Tx, tenantId: string): Promise<CreatedRoles> {
  const byKey = {} as Record<RoleTemplateKey, string>;
  let permissionRows = 0;

  for (const template of ROLE_TEMPLATES) {
    const roleId = await repo.insertRole(tx, {
      tenantId,
      name: template.name,
      isSystem: template.isSystem,
      templateKey: template.key,
    });

    byKey[template.key] = roleId;

    if (template.permissions.length > 0) {
      permissionRows += await repo.insertRolePermissions(tx, {
        tenantId,
        roleId,
        permissions: template.permissions,
      });
    }
  }

  return { byKey, permissionRows };
}

export interface CreatedOwner {
  readonly userId: string;
  /** Se muestra una sola vez. No queda en la base. */
  readonly activationToken: string;
  readonly activationExpiresAt: Date;
}

/**
 * Crea el primer Dueno del local, con su link de activacion.
 *
 * Queda sin contrasena: la elige al activar. El rol se asigna con alcance total
 * (`branchId` nulo) porque el Dueno administra el local entero.
 *
 * El email NO se marca como verificado: lo verifica el mismo link de
 * activacion, en la fase 1.4. Hasta entonces no puede recuperar su clave por
 * email, y es correcto que sea asi.
 */
export async function createOwner(
  tx: Tx,
  data: {
    tenantId: string;
    ownerRoleId: string;
    login: string;
    name: string;
    email: string;
  },
  token: ActivationToken = createActivationToken(),
): Promise<CreatedOwner> {
  const userId = await repo.insertUser(tx, {
    tenantId: data.tenantId,
    login: data.login,
    name: data.name,
    email: data.email,
    activationTokenHash: token.tokenHash,
    activationExpiresAt: token.expiresAt,
  });

  await repo.insertUserBranchRole(tx, {
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
}
