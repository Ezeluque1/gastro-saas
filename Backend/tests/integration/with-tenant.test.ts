import { afterAll, describe, expect, it } from 'vitest';

import {
  disconnectDatabase,
  withTenant,
  withoutTenant,
} from '../../src/shared/db/index.js';

/**
 * El mecanismo de aislamiento, contra PostgreSQL real.
 *
 * Esto NO prueba todavia las politicas RLS: no hay tablas de negocio hasta la
 * Fase 1. Lo que prueba es el mecanismo del que dependen esas politicas: que
 * `app.tenant_id` quede fijado dentro de la transaccion y que NO sobreviva a
 * ella.
 *
 * Es la prueba mas importante de la Fase 0. El tercer argumento de set_config
 * en `true` es lo que hace que el valor viva solo en la transaccion; sin eso el
 * valor queda pegado a la conexion y la siguiente request que tome esa conexion
 * del pool arranca con el tenant de otro local. Seria el bug mas caro del
 * proyecto, y no se puede detectar con simulaciones: hace falta una base real y
 * un pool real.
 *
 * docs/Backend: "Prisma y el contexto de tenant" y "Pruebas" (Aislamiento
 * entre tenants).
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

afterAll(async () => {
  await disconnectDatabase();
});

async function currentTenant(tx: {
  $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T>;
}): Promise<string> {
  // `true` como segundo argumento devuelve cadena vacia en vez de error cuando
  // el parametro no esta fijado.
  const rows = await tx.$queryRaw<{ tenant: string }[]>`
    SELECT current_setting('app.tenant_id', true) AS tenant
  `;
  return rows[0]?.tenant ?? '';
}

describe('withTenant', () => {
  it('fija app.tenant_id dentro de la transaccion', async () => {
    const visto = await withTenant(TENANT_A, async (tx) => currentTenant(tx));

    expect(visto).toBe(TENANT_A);
  });

  it('no filtra el tenant a la transaccion siguiente', async () => {
    // El caso que previene el bug: dos requests seguidas que pueden tomar la
    // misma conexion del pool. La segunda no debe ver nada de la primera.
    await withTenant(TENANT_A, async (tx) => {
      expect(await currentTenant(tx)).toBe(TENANT_A);
    });

    const despues = await withoutTenant('health', async (tx) => currentTenant(tx));

    expect(despues).toBe('');
  });

  it('no filtra el tenant ni cuando la transaccion falla', async () => {
    // Un rollback tampoco puede dejar el valor pegado a la conexion.
    await expect(
      withTenant(TENANT_A, async (tx) => {
        await currentTenant(tx);
        throw new Error('rollback a proposito');
      }),
    ).rejects.toThrow('rollback a proposito');

    const despues = await withoutTenant('health', async (tx) => currentTenant(tx));

    expect(despues).toBe('');
  });

  it('mantiene cada tenant en su transaccion con llamadas en paralelo', async () => {
    // Varias requests concurrentes, cada una con su conexion: ninguna puede
    // ver el tenant de otra.
    const resultados = await Promise.all([
      withTenant(TENANT_A, async (tx) => currentTenant(tx)),
      withTenant(TENANT_B, async (tx) => currentTenant(tx)),
      withTenant(TENANT_A, async (tx) => currentTenant(tx)),
      withTenant(TENANT_B, async (tx) => currentTenant(tx)),
    ]);

    expect(resultados).toEqual([TENANT_A, TENANT_B, TENANT_A, TENANT_B]);
  });

  it('mantiene el mismo tenant durante toda la transaccion', async () => {
    // Varias consultas seguidas dentro de una transaccion: el valor no se
    // pierde entre una y otra.
    const vistos = await withTenant(TENANT_B, async (tx) => {
      const uno = await currentTenant(tx);
      await tx.$queryRaw`SELECT 1`;
      const dos = await currentTenant(tx);
      return [uno, dos];
    });

    expect(vistos).toEqual([TENANT_B, TENANT_B]);
  });

  it('deja que el error de negocio pase sin envolverlo', async () => {
    // withTenant no debe convertir un error del servicio en otra cosa: el
    // manejador central necesita el AppError original.
    const { NotFoundError } = await import('../../src/shared/errors/index.js');

    await expect(
      withTenant(TENANT_A, () => Promise.reject(new NotFoundError('no esta'))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('rol de la aplicacion', () => {
  it('no es superusuario y no tiene BYPASSRLS', async () => {
    // Si el rol de la aplicacion tuviera BYPASSRLS, las politicas RLS de la
    // Fase 1 no servirian de nada y el aislamiento seria falso.
    const rows = await withoutTenant(
      'health',
      (tx) =>
        tx.$queryRaw<{ super: boolean; bypass: boolean; usuario: string }[]>`
        SELECT rolsuper AS "super", rolbypassrls AS bypass, current_user AS usuario
        FROM pg_roles
        WHERE rolname = current_user
      `,
    );

    expect(rows[0]?.super).toBe(false);
    expect(rows[0]?.bypass).toBe(false);
  });

  it('no es el dueno de las tablas', async () => {
    // Con FORCE ROW LEVEL SECURITY el dueno tampoco se saltea RLS, pero igual
    // la aplicacion no debe poder alterar el esquema.
    const rows = await withoutTenant(
      'health',
      async (tx) => tx.$queryRaw<{ usuario: string }[]>`SELECT current_user AS usuario`,
    );

    expect(rows[0]?.usuario).toBe('gastro_app');
  });
});
