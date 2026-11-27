import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  disconnectDatabase,
  withTenant,
  withoutTenant,
} from '../../src/shared/db/index.js';
import {
  TENANT_TABLES,
  countIn,
  seedTenant,
  type SeededTenant,
} from '../helpers/seed-tenants.js';

/**
 * Aislamiento entre locales, contra PostgreSQL real.
 *
 * Es la prueba que mas protege el producto. El plan de desarrollo lo dice sin
 * vueltas: "RLS mal configurado es el error mas caro de todo el proyecto".
 *
 * Lo que se verifica no es que la aplicacion filtre bien, sino que la BASE no
 * deje pasar datos de otro local aunque la aplicacion se equivoque. Por eso
 * varias pruebas rompen el filtro a proposito.
 *
 * Todo corre con el rol gastro_app, que no es superusuario, no es dueno de las
 * tablas y no tiene BYPASSRLS. Si corriera con el rol migrador, estas pruebas
 * pasarian sin probar nada.
 *
 * docs/Backend: "Multitenancy y aislamiento de datos" y "Pruebas".
 */

let localA: SeededTenant;
let localB: SeededTenant;

beforeAll(async () => {
  localA = await seedTenant('local-a');
  localB = await seedTenant('local-b');
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('lectura', () => {
  it('cada local ve exactamente sus propias filas, tabla por tabla', async () => {
    // Hay datos de dos locales en cada tabla, pero cada contexto ve una sola
    // fila: la propia.
    for (const table of TENANT_TABLES) {
      expect(await countIn(localA.id, table), `${table} desde A`).toBe(1);
      expect(await countIn(localB.id, table), `${table} desde B`).toBe(1);
    }
  });

  it('A no encuentra una fila de B ni pidiendola por id', async () => {
    const encontrado = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${localB.userId}::uuid
      `;
      return rows.length;
    });

    expect(encontrado).toBe(0);
  });

  it('A no ve el local B en la tabla de locales', async () => {
    // `tenants` es el caso especial: su politica compara `id`, no `tenant_id`.
    const slugs = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<{ slug: string }[]>`SELECT slug FROM tenants`;
      return rows.map((r) => r.slug);
    });

    expect(slugs).toEqual([localA.slug]);
    expect(slugs).not.toContain(localB.slug);
  });

  it('sigue aislado aunque el filtro de la aplicacion este roto', async () => {
    // Este es el caso que justifica RLS. Simula el bug que algun dia alguien va
    // a escribir: una consulta sin `WHERE tenant_id`, o con el tenant
    // equivocado. La base tiene que taparlo.
    const filas = await withTenant(localA.id, async (tx) => {
      const sinFiltro = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users`;
      const conTenantAjeno = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE tenant_id = ${localB.id}::uuid
      `;
      return { sinFiltro: sinFiltro.length, conTenantAjeno: conTenantAjeno.length };
    });

    // Sin filtro ve solo lo suyo, y pidiendo explicitamente las de B no ve nada.
    expect(filas.sinFiltro).toBe(1);
    expect(filas.conTenantAjeno).toBe(0);
  });
});

describe('escritura', () => {
  it('A no puede modificar una fila de B', async () => {
    const afectadas = await withTenant(
      localA.id,
      async (tx) =>
        tx.$executeRaw`UPDATE users SET name = 'intervenido' WHERE id = ${localB.userId}::uuid`,
    );

    expect(afectadas).toBe(0);

    // Y la fila de B quedo intacta.
    const nombre = await withTenant(localB.id, async (tx) => {
      const rows = await tx.$queryRaw<{ name: string }[]>`
        SELECT name FROM users WHERE id = ${localB.userId}::uuid
      `;
      return rows[0]?.name;
    });

    expect(nombre).not.toBe('intervenido');
  });

  it('A no puede modificar filas de B ni con un UPDATE sin WHERE', async () => {
    const afectadas = await withTenant(
      localA.id,
      async (tx) => tx.$executeRaw`UPDATE branches SET name = 'pisada'`,
    );

    // Alcanza solo a la suya.
    expect(afectadas).toBe(1);

    const nombreB = await withTenant(localB.id, async (tx) => {
      const rows = await tx.$queryRaw<{ name: string }[]>`
        SELECT name FROM branches WHERE id = ${localB.branchId}::uuid
      `;
      return rows[0]?.name;
    });

    expect(nombreB).toBe('Sucursal centro');
  });

  it('A no puede borrar una fila de B', async () => {
    const afectadas = await withTenant(
      localA.id,
      async (tx) =>
        tx.$executeRaw`DELETE FROM audit_log WHERE tenant_id = ${localB.id}::uuid`,
    );

    expect(afectadas).toBe(0);
    expect(await countIn(localB.id, 'audit_log')).toBe(1);
  });

  it('A no puede INSERTAR una fila con el tenant_id de B', async () => {
    // Esta es la prueba que atrapa la falta de WITH CHECK en la politica.
    // Con USING sola, este insert pasaria: USING filtra lo que se lee,
    // actualiza y borra, pero no valida lo que se inserta.
    await expect(
      withTenant(localA.id, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO branches (id, tenant_id, name, updated_at)
          VALUES (${randomUUID()}::uuid, ${localB.id}::uuid, 'sucursal infiltrada', now())
        `;
      }),
    ).rejects.toThrow(/row-level security|violates/i);

    // B sigue con una sola sucursal.
    expect(await countIn(localB.id, 'branches')).toBe(1);
  });

  it('A no puede mover una fila propia al tenant de B', async () => {
    // La otra mitad del WITH CHECK: un UPDATE que cambia el tenant_id tiene que
    // fallar, porque el resultado violaria la politica.
    await expect(
      withTenant(localA.id, async (tx) => {
        await tx.$executeRaw`
          UPDATE branches SET tenant_id = ${localB.id}::uuid WHERE id = ${localA.branchId}::uuid
        `;
      }),
    ).rejects.toThrow(/row-level security|violates/i);

    expect(await countIn(localA.id, 'branches')).toBe(1);
    expect(await countIn(localB.id, 'branches')).toBe(1);
  });
});

describe('sin contexto de tenant', () => {
  /**
   * Una consulta fuera de withTenant() tiene que FALLAR, no devolver cero
   * filas.
   *
   * Hay dos errores posibles y los dos sirven, segun si la conexion del pool ya
   * se uso antes:
   *
   *  - Conexion nueva: `current_setting('app.tenant_id')` no conoce el
   *    parametro y levanta "unrecognized configuration parameter".
   *  - Conexion reusada: un set_config previo con alcance de transaccion dejo
   *    el parametro REGISTRADO en la sesion, asi que al terminar esa
   *    transaccion vuelve a cadena vacia en vez de desaparecer. Entonces falla
   *    el cast ''::uuid con "invalid input syntax for type uuid".
   *
   * De ahi se desprende algo que conviene no perder de vista: el cast a uuid es
   * parte de la defensa. Si una politica comparara texto contra texto, la
   * cadena vacia no haria error y simplemente no coincidiria con nada, y una
   * consulta sin contexto devolveria cero filas en silencio, que es justo lo
   * que no queremos.
   */
  const SIN_CONTEXTO =
    /app\.tenant_id|unrecognized configuration parameter|invalid input syntax for type uuid/i;

  it('una consulta falla en vez de devolver cero filas', async () => {
    const error = await withoutTenant('health', async (tx) => {
      await tx.$queryRaw`SELECT id FROM users`;
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error, 'tendria que haber fallado').not.toBeNull();
    expect(String(error)).toMatch(SIN_CONTEXTO);
  });

  it('tampoco se puede insertar sin contexto', async () => {
    const error = await withoutTenant('health', async (tx) => {
      await tx.$executeRaw`
        INSERT INTO branches (id, tenant_id, name, updated_at)
        VALUES (${randomUUID()}::uuid, ${localA.id}::uuid, 'sin contexto', now())
      `;
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error, 'tendria que haber fallado').not.toBeNull();
    expect(String(error)).toMatch(SIN_CONTEXTO);

    // Y no entro la fila.
    expect(await countIn(localA.id, 'branches')).toBe(1);
  });
});

describe('tablas de plataforma', () => {
  it('la aplicacion no puede leer la auditoria de plataforma', async () => {
    // platform_audit_log registra acciones del administrador y el uso de las
    // funciones SECURITY DEFINER. No es de ningun local, y un local no tiene
    // que poder enterarse de lo que pasa en la plataforma.
    await expect(
      withTenant(localA.id, async (tx) => {
        await tx.$queryRaw`SELECT id FROM platform_audit_log`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('la aplicacion lee los planes pero no los modifica', async () => {
    const cantidad = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*)::bigint AS n FROM plans`;
      return Number(rows[0]?.n ?? 0n);
    });

    expect(cantidad).toBeGreaterThan(0);

    await expect(
      withTenant(localA.id, async (tx) => {
        await tx.$executeRaw`UPDATE plans SET max_branches = 99`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('permisos del rol de la aplicacion', () => {
  it('tiene lectura y escritura en cada tabla con RLS', async () => {
    // No alcanza con que las politicas esten bien: si el ALTER DEFAULT
    // PRIVILEGES de la migracion inicial no hubiera alcanzado a las tablas
    // nuevas, la aplicacion fallaria con "permission denied" en produccion.
    const faltantes = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<{ table_name: string; privs: string }[]>`
        SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
        FROM information_schema.table_privileges
        WHERE grantee = 'gastro_app' AND table_schema = 'public'
        GROUP BY table_name
      `;
      const porTabla = new Map(rows.map((r) => [r.table_name, r.privs]));

      return TENANT_TABLES.filter((t) => {
        const privs = porTabla.get(t) ?? '';
        return !['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((p) => privs.includes(p));
      });
    });

    expect(faltantes).toEqual([]);
  });

  it('no es superusuario, no es dueno de las tablas y no tiene BYPASSRLS', async () => {
    // Si alguna de las tres fuera falsa, todas las pruebas de arriba pasarian
    // sin probar nada.
    const rol = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<
        { usuario: string; es_super: boolean; bypass: boolean; duenos: bigint }[]
      >`
        SELECT current_user AS usuario,
               r.rolsuper AS es_super,
               r.rolbypassrls AS bypass,
               (SELECT count(*)::bigint FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r'
                   AND pg_get_userbyid(c.relowner) = current_user) AS duenos
        FROM pg_roles r WHERE r.rolname = current_user
      `;
      return rows[0];
    });

    expect(rol?.usuario).toBe('gastro_app');
    expect(rol?.es_super).toBe(false);
    expect(rol?.bypass).toBe(false);
    expect(Number(rol?.duenos ?? 0n)).toBe(0);
  });
});

describe('configuracion de RLS en el catalogo', () => {
  /**
   * Estas pruebas miran el catalogo de Postgres en vez del comportamiento, y no
   * son redundantes: hay configuracion que las pruebas de comportamiento NO
   * pueden detectar.
   *
   * El caso concreto es FORCE ROW LEVEL SECURITY. FORCE solo cambia algo para
   * el DUENO de la tabla, y estas pruebas corren como gastro_app, que no lo es.
   * Se verifico: quitando FORCE, las 15 pruebas de comportamiento siguen
   * pasando. Sin esta comprobacion, un FORCE perdido llegaria a produccion, y
   * ahi importa, porque las migraciones corren como dueno.
   *
   * La otra razon es la deriva futura: la lista de tablas NO esta escrita a
   * mano, se descubre de la base. Una tabla nueva con tenant_id a la que se le
   * olvide la politica rompe esta prueba sola, sin que nadie se acuerde de
   * agregarla aca.
   */

  /**
   * Tablas con columna tenant_id que a proposito NO llevan RLS de tenant.
   *
   * platform_audit_log registra acciones de la plataforma y el uso de las
   * funciones SECURITY DEFINER. Su tenant_id dice a que local afecto la accion,
   * no de quien es la fila. El aislamiento ahi se hace quitandole todo permiso
   * al rol de la aplicacion, no con una politica.
   */
  const SIN_RLS_A_PROPOSITO = ['platform_audit_log'];

  interface EstadoTabla {
    tabla: string;
    rls: boolean;
    force: boolean;
    politicas: bigint;
    con_using: bigint;
  }

  async function estadoDeTablasConTenantId(): Promise<EstadoTabla[]> {
    // Cualquier contexto sirve: el catalogo no tiene RLS.
    return withTenant(
      localA.id,
      async (tx) =>
        tx.$queryRaw<EstadoTabla[]>`
        SELECT c.relname AS tabla,
               c.relrowsecurity AS rls,
               c.relforcerowsecurity AS force,
               (SELECT count(*)::bigint FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
               (SELECT count(*)::bigint FROM pg_policies pp
                 WHERE pp.schemaname = 'public' AND pp.tablename = c.relname
                   AND pp.qual LIKE '%app.tenant_id%') AS con_using
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'public'
               AND col.table_name = c.relname
               AND col.column_name = 'tenant_id'
          )
        ORDER BY c.relname
      `,
    );
  }

  it('toda tabla con tenant_id tiene RLS activo y forzado, con su politica', async () => {
    const tablas = (await estadoDeTablasConTenantId()).filter(
      (t) => !SIN_RLS_A_PROPOSITO.includes(t.tabla),
    );

    // Si esto es 0, la consulta esta mal y la prueba no verifica nada.
    expect(tablas.length).toBeGreaterThan(5);

    const mal = tablas.filter(
      (t) => !t.rls || !t.force || Number(t.politicas) === 0 || Number(t.con_using) === 0,
    );

    expect(
      mal.map(
        (t) =>
          `${t.tabla}: rls=${String(t.rls)} force=${String(t.force)}` +
          ` politicas=${String(t.politicas)}`,
      ),
      'tablas con RLS mal configurado',
    ).toEqual([]);
  });

  it('la tabla de locales tambien, aunque su politica compare id', async () => {
    // `tenants` no tiene columna tenant_id, asi que la consulta de arriba no la
    // alcanza: se verifica aparte para que no quede fuera de la red.
    const estado = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<{ rls: boolean; force: boolean; qual: string }[]>`
        SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, p.qual
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
        WHERE n.nspname = 'public' AND c.relname = 'tenants'
      `;
      return rows[0];
    });

    expect(estado?.rls).toBe(true);
    expect(estado?.force).toBe(true);
    expect(estado?.qual).toContain('app.tenant_id');
    // Compara `id`, no `tenant_id`: el id de esta tabla ES el tenant. Queda
    // explicito para que no parezca un descuido al leer la migracion.
    expect(estado?.qual.startsWith('(id =')).toBe(true);
  });

  it('platform_audit_log sigue sin RLS y sin permisos para la aplicacion', async () => {
    // La contracara de la lista de excepciones: si alguien le agregara una
    // politica pensando que falta, o le devolviera el GRANT, esto lo marca.
    const estado = await withTenant(localA.id, async (tx) => {
      const rows = await tx.$queryRaw<{ rls: boolean; privilegios: bigint }[]>`
        SELECT c.relrowsecurity AS rls,
               (SELECT count(*)::bigint FROM information_schema.table_privileges tp
                 WHERE tp.table_schema = 'public'
                   AND tp.table_name = 'platform_audit_log'
                   AND tp.grantee = 'gastro_app') AS privilegios
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'platform_audit_log'
      `;
      return rows[0];
    });

    expect(estado?.rls).toBe(false);
    expect(Number(estado?.privilegios ?? 0n)).toBe(0);
  });
});
