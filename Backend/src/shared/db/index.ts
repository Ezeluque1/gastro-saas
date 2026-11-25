// Interfaz publica de shared/db.
//
// A proposito NO se exporta el cliente `prisma`: fuera de esta carpeta se
// trabaja siempre con la transaccion que entrega withTenant().
export {
  withTenant,
  withoutTenant,
  checkDatabase,
  disconnectDatabase,
} from './with-tenant.js';
export type { Tx } from './tx.js';
