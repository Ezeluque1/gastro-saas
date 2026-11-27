import type { Tx } from '../../../shared/db/index.js';
import { ROLE_TEMPLATES, type RoleTemplateKey } from '../domain/permissions.js';
import type { UserRepository } from '../domain/user.repository.js';

/**
 * Caso de uso: crear los cuatro roles base del local, copiados de la plantilla.
 *
 * El Dueno se crea SIN filas en `role_permissions`: sus permisos se calculan en
 * el codigo a partir de `template_key = 'owner'`. Es deliberado — asi un
 * permiso nuevo del catalogo le llega solo, sin migrar datos y sin riesgo de
 * que un local quede con un Dueno al que le falta algo.
 *
 * Cambiar la plantilla despues NO modifica los roles de los locales ya
 * creados: para eso va una migracion.
 */

export interface CreatedRoles {
  readonly byKey: Readonly<Record<RoleTemplateKey, string>>;
  readonly permissionRows: number;
}

export function makeCreateBaseRoles(repo: UserRepository) {
  return async function createBaseRoles(tx: Tx, tenantId: string): Promise<CreatedRoles> {
    const byKey = {} as Record<RoleTemplateKey, string>;
    let permissionRows = 0;

    for (const template of ROLE_TEMPLATES) {
      const roleId = await repo.createRole(tx, {
        tenantId,
        name: template.name,
        isSystem: template.isSystem,
        templateKey: template.key,
      });

      byKey[template.key] = roleId;

      permissionRows += await repo.grantPermissions(tx, {
        tenantId,
        roleId,
        permissions: template.permissions,
      });
    }

    return { byKey, permissionRows };
  };
}

export type CreateBaseRoles = ReturnType<typeof makeCreateBaseRoles>;
