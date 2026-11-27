import { randomUUID } from 'node:crypto';

import type { Tx } from '../../shared/db/index.js';

import type { Permission, RoleTemplateKey } from './permissions.js';

/**
 * Consultas sobre las tablas del modulo `users`.
 *
 * Siempre con la transaccion recibida.
 */

/** Crea un rol y devuelve su id. */
export async function insertRole(
  tx: Tx,
  data: {
    tenantId: string;
    name: string;
    isSystem: boolean;
    templateKey: RoleTemplateKey | null;
  },
): Promise<string> {
  const id = randomUUID();

  await tx.$executeRaw`
    INSERT INTO roles (id, tenant_id, name, is_system, template_key, updated_at)
    VALUES (${id}::uuid, ${data.tenantId}::uuid, ${data.name}, ${data.isSystem},
            ${data.templateKey}, now())
  `;

  return id;
}

/**
 * Otorga permisos a un rol.
 *
 * Se insertan de a uno con la transaccion recibida. Son unas decenas de filas
 * por local nuevo y pasa una sola vez en la vida del local, asi que no vale
 * complicarlo con un insert masivo.
 */
export async function insertRolePermissions(
  tx: Tx,
  data: { tenantId: string; roleId: string; permissions: readonly Permission[] },
): Promise<number> {
  for (const permission of data.permissions) {
    await tx.$executeRaw`
      INSERT INTO role_permissions (id, tenant_id, role_id, permission_code)
      VALUES (${randomUUID()}::uuid, ${data.tenantId}::uuid, ${data.roleId}::uuid, ${permission})
    `;
  }

  return data.permissions.length;
}

/** Crea un usuario y devuelve su id. */
export async function insertUser(
  tx: Tx,
  data: {
    tenantId: string;
    login: string;
    name: string;
    email: string | null;
    activationTokenHash: string | null;
    activationExpiresAt: Date | null;
  },
): Promise<string> {
  const id = randomUUID();

  // password_hash queda nulo: el usuario elige su clave al activar la cuenta,
  // asi el administrador nunca la conoce.
  await tx.$executeRaw`
    INSERT INTO users (
      id, tenant_id, login, name, email,
      activation_token_hash, activation_expires_at, updated_at
    )
    VALUES (
      ${id}::uuid, ${data.tenantId}::uuid, ${data.login}, ${data.name}, ${data.email},
      ${data.activationTokenHash}, ${data.activationExpiresAt}, now()
    )
  `;

  return id;
}

/**
 * Asigna un rol a un usuario en una sucursal.
 *
 * `branchId` nulo significa "el mismo rol en todas las sucursales". El Dueno se
 * crea asi, porque los permisos que afectan a todo el local (precios,
 * configuracion, usuarios) solo valen con alcance total.
 */
export async function insertUserBranchRole(
  tx: Tx,
  data: { tenantId: string; userId: string; branchId: string | null; roleId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO user_branch_roles (id, tenant_id, user_id, branch_id, role_id)
    VALUES (${randomUUID()}::uuid, ${data.tenantId}::uuid, ${data.userId}::uuid,
            ${data.branchId}::uuid, ${data.roleId}::uuid)
  `;
}
