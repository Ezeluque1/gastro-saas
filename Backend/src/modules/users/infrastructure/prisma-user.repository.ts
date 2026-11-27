import type { UserRepository } from '../domain/user.repository.js';

/**
 * Implementacion de `UserRepository` con Prisma Client.
 *
 * Cliente tipado y no SQL crudo: el documento reserva el SQL crudo para donde
 * hace falta atomicidad, y aca no es el caso. Ademas `@updatedAt` se encarga de
 * `updated_at`, que es NOT NULL y sin default en la base.
 */
export const prismaUserRepository: UserRepository = {
  async createRole(tx, data): Promise<string> {
    const role = await tx.role.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        isSystem: data.isSystem,
        templateKey: data.templateKey,
      },
      select: { id: true },
    });

    return role.id;
  },

  async grantPermissions(tx, data): Promise<number> {
    if (data.permissions.length === 0) return 0;

    // createMany en una sola ida a la base, en vez de un insert por permiso.
    const { count } = await tx.rolePermission.createMany({
      data: data.permissions.map((permission) => ({
        tenantId: data.tenantId,
        roleId: data.roleId,
        permissionCode: permission,
      })),
    });

    return count;
  },

  async createUser(tx, data): Promise<string> {
    // passwordHash queda nulo: el usuario elige su clave al activar la cuenta,
    // asi el administrador que da de alta el local nunca la conoce.
    const user = await tx.user.create({
      data: {
        tenantId: data.tenantId,
        login: data.login,
        name: data.name,
        email: data.email,
        activationTokenHash: data.activationTokenHash,
        activationExpiresAt: data.activationExpiresAt,
      },
      select: { id: true },
    });

    return user.id;
  },

  async assignRole(tx, data): Promise<void> {
    await tx.userBranchRole.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        branchId: data.branchId,
        roleId: data.roleId,
      },
      select: { id: true },
    });
  },
};
