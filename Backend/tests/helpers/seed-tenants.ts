import { randomUUID } from 'node:crypto';

import { withTenant, type Tx } from '../../src/shared/db/index.js';

/**
 * Siembra dos locales con datos propios, para las pruebas de aislamiento.
 *
 * Se inserta con SQL crudo y no con el cliente Prisma por una razon concreta:
 * las pruebas tienen que poder escribir filas de un tenant estando en el
 * contexto de otro, para comprobar que RLS lo impide. El cliente tipado estorba
 * para eso.
 *
 * Todo pasa por withTenant(), igual que la aplicacion: si la siembra necesitara
 * saltearse RLS, el aislamiento estaria mal hecho.
 */

export interface SeededTenant {
  readonly id: string;
  readonly slug: string;
  readonly userId: string;
  readonly branchId: string;
  readonly roleId: string;
}

/** Id del plan base, cacheado entre pruebas. */
let planId: string | null = null;

/**
 * Lee el plan base que siembra la migracion `plan_base`.
 *
 * No lo inserta: `plans` es configuracion de plataforma y el rol de la
 * aplicacion solo tiene SELECT sobre esa tabla. Si una prueba necesitara
 * crearlo, seria senal de que la aplicacion tiene mas permisos de los que
 * deberia.
 */
async function basePlanId(): Promise<string> {
  if (planId !== null) return planId;

  // Cualquier contexto de tenant sirve: `plans` no tiene RLS.
  const id = await withTenant(randomUUID(), async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM plans WHERE name = 'Base' LIMIT 1
    `;
    return rows[0]?.id;
  });

  if (id === undefined) {
    throw new Error(
      'falta el plan Base: aplica las migraciones con npm run db:deploy:test',
    );
  }

  planId = id;
  return id;
}

/**
 * Crea un local con una sucursal, un rol y un usuario.
 *
 * Fija app.tenant_id con el id nuevo ANTES de insertar en `tenants`, que es lo
 * que exige el WITH CHECK de su politica. Es el mismo camino que va a usar
 * create_tenant en la 1.2.
 */
export async function seedTenant(slugPrefix: string): Promise<SeededTenant> {
  const plan = await basePlanId();

  const id = randomUUID();
  const userId = randomUUID();
  const branchId = randomUUID();
  const roleId = randomUUID();
  const slug = `${slugPrefix}-${id.slice(0, 8)}`;

  await withTenant(id, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO tenants (id, name, slug, plan_id, status, updated_at)
      VALUES (${id}::uuid, ${`Local ${slug}`}, ${slug}, ${plan}::uuid, 'active', now())
    `;

    await tx.$executeRaw`
      INSERT INTO tenant_settings (id, tenant_id, updated_at)
      VALUES (${randomUUID()}::uuid, ${id}::uuid, now())
    `;

    await tx.$executeRaw`
      INSERT INTO branches (id, tenant_id, name, updated_at)
      VALUES (${branchId}::uuid, ${id}::uuid, 'Sucursal centro', now())
    `;

    await tx.$executeRaw`
      INSERT INTO roles (id, tenant_id, name, is_system, template_key, updated_at)
      VALUES (${roleId}::uuid, ${id}::uuid, 'Dueño', true, 'owner', now())
    `;

    await tx.$executeRaw`
      INSERT INTO users (id, tenant_id, login, name, updated_at)
      VALUES (${userId}::uuid, ${id}::uuid, 'dueno', ${`Dueño de ${slug}`}, now())
    `;

    await tx.$executeRaw`
      INSERT INTO user_branch_roles (id, tenant_id, user_id, branch_id, role_id)
      VALUES (${randomUUID()}::uuid, ${id}::uuid, ${userId}::uuid, ${branchId}::uuid, ${roleId}::uuid)
    `;

    await tx.$executeRaw`
      INSERT INTO audit_log (id, tenant_id, user_id, entity, entity_id, action)
      VALUES (${randomUUID()}::uuid, ${id}::uuid, ${userId}::uuid, 'tenants', ${id}::uuid, 'created')
    `;
  });

  return { id, slug, userId, branchId, roleId };
}

/** Cuenta filas de una tabla dentro del contexto del tenant dado. */
export async function countIn(tenantId: string, table: string): Promise<number> {
  return withTenant(tenantId, async (tx) => countWith(tx, table));
}

/**
 * Cuenta filas usando la transaccion recibida.
 *
 * El nombre de la tabla se interpola porque no puede ir como parametro, asi que
 * se valida contra una lista blanca: nunca llega de una request, pero no se
 * deja la puerta abierta.
 */
export async function countWith(tx: Tx, table: string): Promise<number> {
  assertKnownTable(table);
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM ${table}`,
  );
  return Number(rows[0]?.n ?? 0n);
}

/** Tablas con tenant_id y politica RLS, en el orden en que se siembran. */
export const TENANT_TABLES = [
  'tenants',
  'tenant_settings',
  'branches',
  'roles',
  'users',
  'user_branch_roles',
  'audit_log',
] as const;

const ALLOWED_TABLES = new Set<string>([
  ...TENANT_TABLES,
  'payment_methods',
  'cash_registers',
  'role_permissions',
  'password_reset_codes',
  'user_sessions',
  'plans',
  'platform_audit_log',
]);

function assertKnownTable(table: string): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`tabla desconocida en una prueba: ${table}`);
  }
}
