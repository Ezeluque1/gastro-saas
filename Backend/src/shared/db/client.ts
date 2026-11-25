import { PrismaPg } from '@prisma/adapter-pg';

import { config } from '../../config/index.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Cliente Prisma de la aplicacion.
 *
 * Se conecta con DATABASE_URL, que es el rol SIN privilegios: no es
 * superusuario, no es dueno de las tablas y no tiene BYPASSRLS. Es lo que hace
 * que las politicas RLS sirvan de verdad.
 *
 * Este cliente NO se exporta fuera de shared/db. Los servicios y repositorios
 * reciben siempre la transaccion (`tx`) que abre withTenant(), y una regla de
 * lint impide importar este archivo desde otro lugar. Si alguien consultara por
 * fuera, RLS devolveria un error en vez de datos de otro local.
 *
 * docs/Backend: "Prisma y el contexto de tenant" (Cliente global oculto).
 */
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type { PrismaClient };
