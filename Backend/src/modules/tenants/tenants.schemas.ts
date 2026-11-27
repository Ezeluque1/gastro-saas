import { z } from 'zod';

/**
 * Validacion de los datos del local.
 *
 * docs/Backend: "Reglas del slug y de la sesion por local".
 */

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

/**
 * Slug del local: se valida como nombre DNS desde el primer dia.
 *
 * Es inmutable una vez creado. Cambiarlo rompe los enlaces que ya se
 * repartieron y el path de las cookies de sesion, asi que no hay endpoint para
 * editarlo.
 */
export const slugSchema = z
  .string()
  .min(2, 'El slug necesita al menos 2 caracteres.')
  .max(63, 'El slug no puede pasar de 63 caracteres.')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'El slug admite minusculas, numeros y guiones, y no puede empezar ni terminar con guion.',
  )
  .refine(
    (value) => !RESERVED_SLUGS.includes(value as (typeof RESERVED_SLUGS)[number]),
    'Ese slug esta reservado por el sistema.',
  );

/** Datos para dar de alta un local. */
export const createTenantSchema = z.strictObject({
  name: z.string().min(2).max(120),
  slug: slugSchema,

  /** Nombre de la primera sucursal. */
  branchName: z.string().min(2).max(120).default('Casa central'),

  ownerName: z.string().min(2).max(120),
  /**
   * El Dueno necesita email: es lo que le permite recuperar su clave solo, sin
   * depender del administrador de plataforma.
   */
  ownerEmail: z.email().max(180),
  /** Con que entra. Unico dentro del local, no en toda la plataforma. */
  ownerLogin: z.string().min(2).max(60).default('dueno'),

  /**
   * Los dos topes en pesos del Recepcionista.
   *
   * Se piden en el alta y NO tienen valor por defecto. Si no se cargan quedan
   * en 0, y 0 significa que todo egreso requiere aprobacion. Es deliberado:
   * con la inflacion, cualquier monto por defecto queda viejo.
   */
  egressLimitAmount: z.coerce.number().min(0).default(0),
  egressShiftLimitAmount: z.coerce.number().min(0).default(0),

  timezone: z.string().min(3).max(64).default('America/Argentina/Buenos_Aires'),
  businessDayCutoff: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'El corte del dia va como HH:MM.')
    .default('05:00'),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
