import { z } from 'zod';

import { loadEnvFile } from './load-env-file.js';

/**
 * Variables de entorno validadas al arrancar. Si falta una requerida o tiene
 * un valor invalido, el proceso no inicia.
 *
 * docs/Backend: "Configuracion | Variables de entorno validadas con Zod al
 * arrancar | La app no inicia si falta una variable".
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  APP_ORIGIN: z.url(),

  /** Rol sin privilegios. Es el unico que usa la aplicacion. */
  DATABASE_URL: z.string().min(1),
  /** Rol migrador. Solo lo usa la CLI de Prisma, nunca la aplicacion. */
  DATABASE_MIGRATION_URL: z.string().min(1),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  BODY_LIMIT: z.string().default('100kb'),

  /** Vacio = monitoreo inactivo. Ver shared/monitoring. */
  MONITORING_DSN: z.string().default(''),
});

export type Config = Readonly<
  z.infer<typeof envSchema> & {
    isProduction: boolean;
    isTest: boolean;
  }
>;

function loadConfig(): Config {
  loadEnvFile();

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // No se usa el logger: todavia no esta construido, y este error tiene que
    // salir siempre, incluso con LOG_LEVEL=silent.
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida. Revisa el archivo .env\n${detail}`);
  }

  const env = parsed.data;

  return Object.freeze({
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  });
}

export const config: Config = loadConfig();
