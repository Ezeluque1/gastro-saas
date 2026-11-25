import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga el archivo .env correspondiente al entorno, si existe, usando el
 * cargador nativo de Node (no hace falta dotenv).
 *
 * En produccion las variables vienen del entorno (contenedor, hosting), no de
 * un archivo: ahi esta funcion no hace nada.
 *
 * Lo que ya este definido en process.env gana sobre el archivo, asi una
 * variable pasada por linea de comandos o por CI pisa el .env local.
 */
export function loadEnvFile(): void {
  if (process.env['NODE_ENV'] === 'production') return;

  const file = process.env['NODE_ENV'] === 'test' ? '.env.test' : '.env';
  const path = resolve(process.cwd(), file);

  if (!existsSync(path)) return;

  process.loadEnvFile(path);
}
