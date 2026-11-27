import {
  makeCreateBaseRoles,
  type CreateBaseRoles,
} from './application/create-base-roles.js';
import { makeCreateOwner, type CreateOwner } from './application/create-owner.js';
import { prismaUserRepository } from './infrastructure/prisma-user.repository.js';

/**
 * Configuracion del modulo `users`.
 *
 * Unico lugar donde `application/` e `infrastructure/` se encuentran.
 */
export interface UsersModule {
  readonly createBaseRoles: CreateBaseRoles;
  readonly createOwner: CreateOwner;
}

export function createUsersModule(): UsersModule {
  return {
    createBaseRoles: makeCreateBaseRoles(prismaUserRepository),
    createOwner: makeCreateOwner(prismaUserRepository),
  };
}

export const usersModule = createUsersModule();
