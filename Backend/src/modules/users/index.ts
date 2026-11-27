// Interfaz publica del modulo `users`.
export { usersModule, createUsersModule } from './users.module.js';
export type { UsersModule } from './users.module.js';

export type { CreatedRoles } from './application/create-base-roles.js';
export type { CreatedOwner } from './application/create-owner.js';

export {
  createActivationToken,
  hashActivationToken,
  buildActivationLink,
  ACTIVATION_TOKEN_TTL_HOURS,
} from './domain/activation-token.js';
export type { ActivationToken } from './domain/activation-token.js';

export {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_KEYS,
  TENANT_WIDE_PERMISSIONS,
  OWNER_HAS_ALL_PERMISSIONS,
  PERMISSIONS_NOT_IN_TEMPLATE,
  isPermission,
} from './domain/permissions.js';
export type { Permission, RoleTemplate, RoleTemplateKey } from './domain/permissions.js';
