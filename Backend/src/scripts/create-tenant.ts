import { config } from '../config/index.js';
import { platformModule } from '../modules/platform/index.js';
import { createTenantSchema } from '../modules/tenants/index.js';
import {
  buildActivationLink,
  ACTIVATION_TOKEN_TTL_HOURS,
} from '../modules/users/index.js';
import { disconnectDatabase } from '../shared/db/index.js';
import { logger } from '../shared/logger/index.js';

/**
 * Alta de un local.
 *
 * En el MVP el alta la hace el administrador de plataforma con este script: con
 * 1 a 5 locales durante el piloto es barato, seguro y coincide con el
 * onboarding acompanado. No hay endpoint de alta.
 *
 *   npm run create-tenant -- --name "Rotiseria El Buen Sabor" --slug el-buen-sabor \
 *     --owner-name "Ana Perez" --owner-email ana@ejemplo.com \
 *     --egress-limit 50000 --egress-shift-limit 150000
 *
 * docs/Backend: "Plataforma: alta de locales y estado del tenant".
 */

const USAGE = `
Alta de un local.

  npm run create-tenant -- --name <nombre> --slug <slug> --owner-name <nombre> --owner-email <email>

Obligatorios
  --name                  Nombre del local
  --slug                  Identificador en la URL: minusculas, numeros y guiones
  --owner-name            Nombre del Dueno
  --owner-email           Email del Dueno (lo necesita para recuperar su clave)

Opcionales
  --owner-login           Usuario del Dueno (por defecto: dueno)
  --branch                Nombre de la primera sucursal (por defecto: Casa central)
  --timezone              Zona horaria IANA (por defecto: America/Argentina/Buenos_Aires)
  --business-day-cutoff   Inicio del dia comercial, HH:MM (por defecto: 05:00)
  --egress-limit          Tope por egreso, en pesos
  --egress-shift-limit    Tope acumulado de egresos por turno, en pesos

Los dos topes no tienen valor por defecto. Si no se cargan quedan en 0, y con
tope 0 TODO egreso necesita aprobacion del Encargado o del Dueno.
`;

/** Convierte --kebab-case a camelCase y arma un objeto plano. */
function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;

    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      // Un flag sin valor: se deja como cadena vacia para que Zod lo rechace
      // con un mensaje claro en vez de tomarlo como ausente.
      out[key] = '';
      continue;
    }

    out[key] = next;
    i += 1;
  }

  return out;
}

/** Mapea los nombres del CLI a los del esquema. */
function toInput(args: Record<string, string>): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  const directos = ['name', 'slug', 'ownerName', 'ownerEmail', 'ownerLogin', 'timezone'];
  for (const key of directos) {
    if (args[key] !== undefined) input[key] = args[key];
  }

  if (args['branch'] !== undefined) input['branchName'] = args['branch'];
  if (args['businessDayCutoff'] !== undefined) {
    input['businessDayCutoff'] = args['businessDayCutoff'];
  }
  if (args['egressLimit'] !== undefined) input['egressLimitAmount'] = args['egressLimit'];
  if (args['egressShiftLimit'] !== undefined) {
    input['egressShiftLimitAmount'] = args['egressShiftLimit'];
  }

  return input;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args['help'] !== undefined || Object.keys(args).length === 0) {
    logger.info(USAGE);
    return;
  }

  const parsed = createTenantSchema.safeParse(toInput(args));

  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    logger.error(`Datos invalidos:\n${detalle}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const input = parsed.data;
  const result = await platformModule.createTenant(input);

  if (result.alreadyExisted) {
    // Idempotente: no es un error, es el resultado correcto de correrlo dos
    // veces. Por eso sale con codigo 0.
    logger.warn(
      { slug: result.slug, tenantId: result.tenantId },
      'El local ya existia: no se creo nada.',
    );
    logger.info(
      'Si el link de activacion del Dueno vencio, se genera uno nuevo desde el panel de plataforma (fase 8).',
    );
    return;
  }

  const link = buildActivationLink(
    config.APP_ORIGIN,
    result.slug,
    result.activationToken,
  );

  logger.info(
    {
      tenantId: result.tenantId,
      slug: result.slug,
      sucursal: result.branchId,
      caja: result.cashRegisterId,
      mediosDePago: result.paymentMethods,
      roles: Object.keys(result.roleIds).length,
      filasDePermisos: result.permissionRows,
      dueno: result.ownerUserId,
    },
    'Local creado.',
  );

  // El link se imprime aparte y sin estructura para que se pueda copiar de una.
  // Es la unica vez que existe en claro: en la base solo queda su hash.
  logger.info(
    `\nLink de activacion del Dueno (un solo uso, vence en ${String(ACTIVATION_TOKEN_TTL_HOURS)} horas):\n\n  ${link}\n`,
  );

  const sinTopes: string[] = [];
  if (input.egressLimitAmount === 0) sinTopes.push('tope por egreso');
  if (input.egressShiftLimitAmount === 0) sinTopes.push('tope acumulado por turno');

  if (sinTopes.length > 0) {
    // Avisar fuerte: un Dueno que no sepa esto va a pensar que el sistema esta
    // roto cuando el Recepcionista no pueda registrar un gasto chico.
    logger.warn(
      `Atencion: ${sinTopes.join(' y ')} quedaron en 0, asi que TODO egreso va a necesitar ` +
        'aprobacion del Encargado o del Dueno. Se cargan desde la configuracion del local, ' +
        'o volviendo a dar de alta con --egress-limit y --egress-shift-limit.',
    );
  }
}

try {
  await main();
} finally {
  await disconnectDatabase();
}
