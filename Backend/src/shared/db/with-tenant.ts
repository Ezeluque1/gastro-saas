import { ServiceUnavailableError } from '../errors/index.js';

import { prisma } from './client.js';
import type { Tx } from './tx.js';

/**
 * Unico punto de entrada a la base para las consultas de negocio.
 *
 * Lo que hace funcionar el aislamiento no es Prisma, que no aplica RLS por su
 * cuenta: es que toda consulta corra dentro de una transaccion donde antes se
 * fijo el tenant. Las politicas RLS leen `app.tenant_id` con
 * `current_setting`, asi que una consulta fuera de este camino no ve nada.
 *
 * El tercer argumento de set_config en `true` es lo importante: hace que el
 * valor viva SOLO durante esta transaccion. Sin eso el valor quedaria pegado a
 * la conexion y la siguiente request que tomara esa conexion del pool
 * arrancaria con el tenant de otro local. Es el bug mas caro que puede tener
 * este proyecto, y hay una prueba dedicada a que no vuelva.
 *
 * docs/Backend: "Prisma y el contexto de tenant" y "Como se identifica el
 * tenant en cada request".
 */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * Transaccion SIN contexto de tenant.
 *
 * Reservado para las tres consultas que el documento permite fuera de RLS
 * (resolver el slug en el login, resolver el numero de WhatsApp en el webhook y
 * el alta de tenants), que se resuelven con funciones SECURITY DEFINER
 * minimas, y para el chequeo de salud.
 *
 * Es deliberadamente incomodo de usar y lleva un motivo obligatorio, que queda
 * en el log: toda llamada nueva aca tiene que justificarse.
 *
 * docs/Backend: "Login y consultas fuera de RLS".
 */
export function withoutTenant<T>(
  reason:
    'resolve_tenant_by_slug' | 'resolve_tenant_by_wa_phone' | 'create_tenant' | 'health',
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma
    .$transaction(async (tx) => fn(tx), { timeout: 5000 })
    .catch((error: unknown) => {
      throw wrapConnectionError(error, reason);
    });
}

/** Cierre ordenado del pool. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Comprueba que la base responda. Lo usa GET /health.
 *
 * No consulta ninguna tabla a proposito: una tabla puede no existir todavia o
 * tener RLS, y lo que interesa saber es si la conexion funciona.
 */
export async function checkDatabase(): Promise<void> {
  await withoutTenant('health', async (tx) => {
    await tx.$queryRaw`SELECT 1`;
  });
}

function wrapConnectionError(error: unknown, reason: string): unknown {
  if (error instanceof ServiceUnavailableError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const looksLikeConnectionProblem =
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection|terminat|shut ?down|too many clients/i.test(
      message,
    );

  if (looksLikeConnectionProblem) {
    return new ServiceUnavailableError(
      reason === 'health'
        ? 'No se pudo conectar con la base de datos.'
        : 'El servicio no esta disponible en este momento.',
    );
  }

  return error;
}
