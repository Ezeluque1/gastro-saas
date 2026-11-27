// Interfaz publica del modulo `users`.
export { createBaseRoles, createOwner } from './users.service.js';
export type { CreatedRoles, CreatedOwner } from './users.service.js';
export {
  createActivationToken,
  hashActivationToken,
  buildActivationLink,
  ACTIVATION_TOKEN_TTL_HOURS,
} from './activation-token.js';
export type { ActivationToken } from './activation-token.js';
export {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_KEYS,
  TENANT_WIDE_PERMISSIONS,
  OWNER_HAS_ALL_PERMISSIONS,
  isPermission,
} from './permissions.js';
export type { Permission, RoleTemplate, RoleTemplateKey } from './permissions.js';
