import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, env } from 'prisma/config';

// Prisma 7 no carga el .env por su cuenta, asi que se hace aca con el cargador
// nativo de Node. Es la misma regla que usa la aplicacion (src/config):
// NODE_ENV=test lee .env.test, en produccion las variables vienen del entorno.
//
// La logica esta duplicada a proposito: este archivo lo carga la CLI de Prisma
// con su propio loader, antes y por fuera del codigo de la aplicacion.
if (process.env['NODE_ENV'] !== 'production') {
  const file = process.env['NODE_ENV'] === 'test' ? '.env.test' : '.env';
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * Configuracion de la CLI de Prisma (migraciones y generacion del cliente).
 *
 * Usa DATABASE_MIGRATION_URL: el rol migrador, dueno de las tablas. La
 * aplicacion nunca se conecta con ese rol, se conecta con DATABASE_URL, que es
 * un rol sin privilegios al que SI le aplican las politicas RLS.
 *
 * docs/Backend: "Dos conexiones, dos roles" y "Migraciones".
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_MIGRATION_URL'),
  },
});
