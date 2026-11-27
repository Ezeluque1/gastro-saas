/**
 * Tipos y reglas del dominio `tenants`.
 *
 * Esta capa no importa nada: ni Prisma, ni Express, ni las otras capas del
 * modulo. Es lo que permite probar las reglas sin base de datos.
 */

/** Estado del local. Decide quien puede entrar y que puede hacer. */
export type TenantStatus = 'pilot' | 'active' | 'past_due' | 'suspended' | 'cancelled';

/** Lo minimo que devuelve resolver un slug: nada mas que esto. */
export interface ResolvedTenant {
  readonly id: string;
  readonly status: TenantStatus;
}

/**
 * Palabras que no pueden ser slug.
 *
 * El slug va en la URL (`app.<dominio>/l/<slug>`) y en el path de la cookie, y
 * el sistema usa otros subdominios y rutas. Un local llamado `admin` o `api`
 * colisionaria con el panel de plataforma o con rutas propias.
 *
 * Tiene que coincidir con el CHECK `tenants_slug_format` de la migracion de la
 * fase 1.1: la base es la que manda, esto es para dar un error claro antes de
 * llegar a ella.
 */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'www',
  'app',
  'static',
  'support',
] as const;

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Por que un slug no sirve. `null` significa que es valido. */
export type SlugProblem = 'too_short' | 'too_long' | 'bad_format' | 'reserved';

/**
 * Valida un slug como nombre DNS.
 *
 * Es una regla del dominio y no de la capa de entrada: el slug define la URL y
 * el path de la cookie del local, asi que su forma es parte del negocio, no un
 * detalle de validacion de formulario.
 */
export function checkSlug(slug: string): SlugProblem | null {
  if (slug.length < 2) return 'too_short';
  if (slug.length > 63) return 'too_long';
  if (!SLUG_PATTERN.test(slug)) return 'bad_format';
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return 'reserved';
  return null;
}

/** Estado inicial de todo local nuevo. */
export const INITIAL_TENANT_STATUS: TenantStatus = 'pilot';

/** Zona horaria y corte del dia por defecto, para un local argentino. */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
export const DEFAULT_BUSINESS_DAY_CUTOFF = '05:00';

/** Datos con los que se da de alta un local, ya validados. */
export interface NewTenant {
  readonly name: string;
  readonly slug: string;
  readonly branchName: string;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerLogin: string;
  /**
   * Los dos topes en pesos del Recepcionista.
   *
   * No tienen valor por defecto: se piden en el alta y, si no se cargan,
   * quedan en 0, lo que significa que todo egreso requiere aprobacion. Es
   * deliberado, porque con la inflacion cualquier monto por defecto queda
   * viejo.
   */
  readonly egressLimitAmount: number;
  readonly egressShiftLimitAmount: number;
  readonly timezone: string;
  readonly businessDayCutoff: string;
}
