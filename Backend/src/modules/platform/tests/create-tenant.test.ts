import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { platformModule } from '../index.js';
import { createTenantSchema, tenantsModule } from '../../tenants/index.js';
import {
  ROLE_TEMPLATES,
  hashActivationToken,
  buildActivationLink,
} from '../../users/index.js';
import { disconnectDatabase, withTenant } from '../../../shared/db/index.js';

/**
 * Alta de un local, contra PostgreSQL real.
 *
 * Lo que se verifica es que el alta deje el local listo para operar el primer
 * dia, que correrla dos veces no duplique nada, y que no abra ningun agujero en
 * el aislamiento que la fase 1.1 dejo probado.
 *
 * docs/Backend: "Plataforma: alta de locales y estado del tenant".
 */

afterAll(async () => {
  await disconnectDatabase();
});

/** Datos minimos validos, con un slug distinto en cada llamada. */
function datos(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createTenantSchema.parse> {
  return createTenantSchema.parse({
    name: 'Rotiseria de prueba',
    slug: `prueba-${randomUUID().slice(0, 8)}`,
    ownerName: 'Ana Perez',
    ownerEmail: `ana-${randomUUID().slice(0, 8)}@ejemplo.com`,
    ...overrides,
  });
}

/** Cuenta filas de una tabla dentro del contexto del local. */
async function contar(tenantId: string, tabla: string): Promise<number> {
  const permitidas = new Set([
    'tenants',
    'tenant_settings',
    'branches',
    'cash_registers',
    'payment_methods',
    'roles',
    'role_permissions',
    'users',
    'user_branch_roles',
  ]);
  if (!permitidas.has(tabla)) throw new Error(`tabla desconocida: ${tabla}`);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM ${tabla}`,
    );
    return Number(rows[0]?.n ?? 0n);
  });
}

describe('alta de un local', () => {
  it('deja el local listo para operar el primer dia', async () => {
    const input = datos();
    const result = await platformModule.createTenant(input);

    expect(result.alreadyExisted).toBe(false);
    if (result.alreadyExisted) return;

    // Una sucursal con su caja, para poder cobrar desde el arranque sin
    // configurar nada.
    expect(await contar(result.tenantId, 'tenants')).toBe(1);
    expect(await contar(result.tenantId, 'tenant_settings')).toBe(1);
    expect(await contar(result.tenantId, 'branches')).toBe(1);
    expect(await contar(result.tenantId, 'cash_registers')).toBe(1);
    expect(await contar(result.tenantId, 'payment_methods')).toBe(4);
    expect(await contar(result.tenantId, 'roles')).toBe(4);
    expect(await contar(result.tenantId, 'users')).toBe(1);
    expect(await contar(result.tenantId, 'user_branch_roles')).toBe(1);
  });

  it('el local arranca en estado piloto', async () => {
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const resuelto = await tenantsModule.resolveTenantBySlug(result.slug);

    expect(resuelto?.status).toBe('pilot');
  });

  it('el Dueno queda con alcance sobre todas las sucursales', async () => {
    // branch_id nulo significa "todas". Los permisos que afectan al local
    // entero (precios, configuracion, usuarios) solo valen con ese alcance.
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const asignacion = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ branch_id: string | null; role_id: string }[]>`
        SELECT branch_id, role_id FROM user_branch_roles
      `;
      return rows[0];
    });

    expect(asignacion?.branch_id).toBeNull();
    expect(asignacion?.role_id).toBe(result.roleIds['owner']);
  });

  it('copia los permisos de cada rol tal como los define la plantilla', async () => {
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const porRol = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<
        { template_key: string; permission_code: string }[]
      >`
        SELECT r.template_key, rp.permission_code
        FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      `;
      const mapa = new Map<string, string[]>();
      for (const row of rows) {
        const lista = mapa.get(row.template_key) ?? [];
        lista.push(row.permission_code);
        mapa.set(row.template_key, lista);
      }
      return mapa;
    });

    for (const template of ROLE_TEMPLATES) {
      const enBase = (porRol.get(template.key) ?? []).sort();
      const enPlantilla = [...template.permissions].sort();

      expect(enBase, `permisos de ${template.key}`).toEqual(enPlantilla);
    }
  });

  it('el Dueno no guarda permisos fila por fila', async () => {
    // Se calculan en el codigo a partir de template_key: asi un permiso nuevo
    // del catalogo le llega solo, sin migrar datos.
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const filas = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        WHERE r.template_key = 'owner'
      `;
      return Number(rows[0]?.n ?? 0n);
    });

    expect(filas).toBe(0);
  });

  it('los cuatro roles quedan protegidos como roles de sistema', async () => {
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const noSistema = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ name: string }[]>`
        SELECT name FROM roles WHERE is_system = false
      `;
      return rows.map((r) => r.name);
    });

    expect(noSistema).toEqual([]);
  });
});

describe('topes del Recepcionista', () => {
  it('los dos topes en pesos quedan en 0 si no se cargan', async () => {
    // Ningun monto en pesos tiene valor por defecto: con la inflacion
    // cualquier numero queda viejo. 0 significa que todo egreso requiere
    // aprobacion, y es la opcion segura.
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const topes = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<
        { egreso: string; turno: string; descuento: string }[]
      >`
        SELECT egress_limit_amount::text AS egreso,
               egress_shift_limit_amount::text AS turno,
               discount_limit_percent::text AS descuento
        FROM tenant_settings
      `;
      return rows[0];
    });

    expect(Number(topes?.egreso)).toBe(0);
    expect(Number(topes?.turno)).toBe(0);
    // El de descuento SI tiene default, porque es un porcentaje y no envejece.
    expect(Number(topes?.descuento)).toBe(10);
  });

  it('guarda los topes que se cargan en el alta', async () => {
    const result = await platformModule.createTenant(
      datos({ egressLimitAmount: 50000, egressShiftLimitAmount: 150000 }),
    );
    if (result.alreadyExisted) expect.unreachable();

    const topes = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ egreso: string; turno: string }[]>`
        SELECT egress_limit_amount::text AS egreso, egress_shift_limit_amount::text AS turno
        FROM tenant_settings
      `;
      return rows[0];
    });

    expect(Number(topes?.egreso)).toBe(50000);
    expect(Number(topes?.turno)).toBe(150000);
  });

  it('usa la zona horaria y el corte del dia de Argentina por defecto', async () => {
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const ajustes = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ timezone: string; cutoff: string }[]>`
        SELECT timezone, business_day_cutoff AS cutoff FROM tenant_settings
      `;
      return rows[0];
    });

    expect(ajustes?.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(ajustes?.cutoff).toBe('05:00');
  });
});

describe('idempotencia', () => {
  it('correrla dos veces con el mismo slug no duplica nada', async () => {
    const input = datos();

    const primera = await platformModule.createTenant(input);
    expect(primera.alreadyExisted).toBe(false);
    if (primera.alreadyExisted) return;

    const segunda = await platformModule.createTenant(input);

    expect(segunda.alreadyExisted).toBe(true);
    expect(segunda.tenantId).toBe(primera.tenantId);

    // Y no quedo un segundo juego de roles, usuarios ni sucursales.
    expect(await contar(primera.tenantId, 'roles')).toBe(4);
    expect(await contar(primera.tenantId, 'users')).toBe(1);
    expect(await contar(primera.tenantId, 'branches')).toBe(1);
  });

  it('no crea un segundo Dueno ni un segundo link de activacion', async () => {
    const input = datos();
    const primera = await platformModule.createTenant(input);
    if (primera.alreadyExisted) expect.unreachable();

    const hashOriginal = await withTenant(primera.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ h: string }[]>`
        SELECT activation_token_hash AS h FROM users
      `;
      return rows[0]?.h;
    });

    await platformModule.createTenant(input);

    const hashDespues = await withTenant(primera.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ h: string }[]>`
        SELECT activation_token_hash AS h FROM users
      `;
      return rows[0]?.h;
    });

    // Importa: si el segundo intento regenerara el token, invalidaria el link
    // que ya se le mando al Dueno.
    expect(hashDespues).toBe(hashOriginal);
  });
});

describe('atomicidad', () => {
  it('si algo falla a mitad, no queda nada a medias', async () => {
    // Se fuerza el fallo con un login de 61 caracteres, uno mas de lo que
    // admite la columna. El esquema Zod lo rechazaria antes, asi que la entrada
    // se arma a mano a proposito: lo que se quiere probar es que la BASE corte
    // la operacion despues de haber creado tenant, configuracion, sucursal,
    // caja, medios de pago y los cuatro roles, y que no quede nada de eso.
    const slug = `atomico-${randomUUID().slice(0, 8)}`;

    const entradaQueFallaAlFinal = {
      name: 'Rotiseria atomica',
      slug,
      branchName: 'Casa central',
      ownerName: 'Ana Perez',
      ownerEmail: `ana-${randomUUID().slice(0, 8)}@ejemplo.com`,
      ownerLogin: 'x'.repeat(61),
      egressLimitAmount: 0,
      egressShiftLimitAmount: 0,
      timezone: 'America/Argentina/Buenos_Aires',
      businessDayCutoff: '05:00',
    };

    await expect(platformModule.createTenant(entradaQueFallaAlFinal)).rejects.toThrow(
      /too long|varying/i,
    );

    // El local no tiene que existir: la transaccion se revirtio completa.
    expect(await tenantsModule.resolveTenantBySlug(slug)).toBeNull();
  });

  it('un slug que ya existe no puede duplicarse ni ganando la carrera', async () => {
    // La idempotencia chequea primero, pero si dos altas simultaneas pasaran
    // ese chequeo, lo que corta es la restriccion unica de tenants.slug. Se
    // comprueba salteando el chequeo: se llama dos veces en paralelo.
    const input = datos();

    const resultados = await Promise.allSettled([
      platformModule.createTenant(input),
      platformModule.createTenant(input),
    ]);

    const creados = resultados.filter(
      (r) => r.status === 'fulfilled' && !r.value.alreadyExisted,
    );

    // Como maximo uno creo el local. El otro o lo encontro, o choco con la
    // restriccion unica; las dos salidas son correctas.
    expect(creados.length).toBeLessThanOrEqual(1);

    const resuelto = await tenantsModule.resolveTenantBySlug(input.slug);
    expect(resuelto).not.toBeNull();
  });
});

describe('aislamiento', () => {
  it('dos locales creados por el alta siguen aislados entre si', async () => {
    // El alta es la primera cosa que escribe datos reales: vale confirmar que
    // no abrio ningun agujero en lo que la fase 1.1 dejo probado.
    const a = await platformModule.createTenant(datos());
    const b = await platformModule.createTenant(datos());
    if (a.alreadyExisted || b.alreadyExisted) expect.unreachable();

    expect(a.tenantId).not.toBe(b.tenantId);

    // Cada uno ve un solo local, un solo usuario y cuatro roles: los suyos.
    for (const local of [a, b]) {
      expect(await contar(local.tenantId, 'tenants')).toBe(1);
      expect(await contar(local.tenantId, 'users')).toBe(1);
      expect(await contar(local.tenantId, 'roles')).toBe(4);
    }

    // Y A no encuentra al Dueno de B ni pidiendolo por id.
    const encontrado = await withTenant(a.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${b.ownerUserId}::uuid
      `;
      return rows.length;
    });

    expect(encontrado).toBe(0);
  });
});

describe('link de activacion', () => {
  it('en la base queda solo el hash, nunca el token', async () => {
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const guardado = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ h: string; vence: Date }[]>`
        SELECT activation_token_hash AS h, activation_expires_at AS vence FROM users
      `;
      return rows[0];
    });

    // El hash corresponde al token, pero el token no esta.
    expect(guardado?.h).toBe(hashActivationToken(result.activationToken));
    expect(guardado?.h).not.toContain(result.activationToken);
    expect(guardado?.h).toMatch(/^[0-9a-f]{64}$/);
    expect(guardado?.vence).toBeInstanceOf(Date);
  });

  it('el usuario queda sin contrasena hasta que active', async () => {
    // Asi el administrador que da de alta el local nunca conoce la clave del
    // Dueno.
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const usuario = await withTenant(result.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<
        { hash: string | null; verificado: Date | null; debeCambiar: boolean }[]
      >`
        SELECT password_hash AS hash, email_verified_at AS verificado,
               must_change_password AS "debeCambiar"
        FROM users
      `;
      return rows[0];
    });

    expect(usuario?.hash).toBeNull();
    // El email se verifica con el mismo link de activacion, no antes.
    expect(usuario?.verificado).toBeNull();
    expect(usuario?.debeCambiar).toBe(false);
  });

  it('el link lleva el slug en el path y el token como parametro', () => {
    const link = buildActivationLink(
      'https://app.ejemplo.com/',
      'mi-local',
      'abc+def/ghi',
    );

    expect(link).toContain('/l/mi-local/');
    // El token va escapado: base64url no trae caracteres raros, pero el helper
    // no puede asumirlo.
    expect(link).toContain(encodeURIComponent('abc+def/ghi'));
    // Sin barra doble por el origen con barra final.
    expect(link).not.toContain('com//');
  });
});

describe('resolve_tenant_by_slug', () => {
  it('devuelve el local y su estado', async () => {
    const result = await platformModule.createTenant(datos());
    if (result.alreadyExisted) expect.unreachable();

    const resuelto = await tenantsModule.resolveTenantBySlug(result.slug);

    expect(resuelto?.id).toBe(result.tenantId);
    expect(resuelto?.status).toBe('pilot');
  });

  it('devuelve null para un slug que no existe', async () => {
    // No distingue de ninguna otra causa: el login responde el mismo error
    // para local inexistente, usuario inexistente y clave incorrecta, asi no se
    // pueden enumerar los locales de la plataforma.
    expect(
      await tenantsModule.resolveTenantBySlug(`no-existe-${randomUUID().slice(0, 8)}`),
    ).toBeNull();
  });

  it('registra cada uso, incluso los que no encuentran nada', async () => {
    // Es lo que deja rastro de alguien probando nombres de locales.
    const slug = `inventado-${randomUUID().slice(0, 8)}`;

    await tenantsModule.resolveTenantBySlug(slug);

    // La aplicacion no puede leer platform_audit_log, asi que no se puede
    // verificar desde aca con el rol de la app. Lo que si se verifica es que la
    // llamada no falle: si el log fallara, la funcion entera fallaria, porque
    // escribe antes de buscar.
    expect(await tenantsModule.resolveTenantBySlug(slug)).toBeNull();
  });
});

describe('validacion del slug', () => {
  it.each([
    ['con mayusculas', 'El-Buen-Sabor'],
    ['reservado admin', 'admin'],
    ['reservado api', 'api'],
    ['empieza con guion', '-local'],
    ['termina con guion', 'local-'],
    ['demasiado corto', 'a'],
    ['con espacios', 'mi local'],
    ['con acentos', 'rotiseria-ñ'],
    ['con barra', 'local/otro'],
  ])('rechaza un slug %s', (_caso, slug) => {
    const parsed = createTenantSchema.safeParse({
      name: 'Local',
      slug,
      ownerName: 'Ana Perez',
      ownerEmail: 'ana@ejemplo.com',
    });

    expect(parsed.success, `deberia rechazar "${slug}"`).toBe(false);
  });

  it.each([
    ['simple', 'rotiseria'],
    ['con guion', 'el-buen-sabor'],
    ['con numeros', 'local-2'],
  ])('acepta un slug %s', (_caso, slug) => {
    const parsed = createTenantSchema.safeParse({
      name: 'Local',
      slug,
      ownerName: 'Ana Perez',
      ownerEmail: 'ana@ejemplo.com',
    });

    expect(parsed.success, `deberia aceptar "${slug}"`).toBe(true);
  });
});
