import { z } from 'zod';

import {
  DEFAULT_BUSINESS_DAY_CUTOFF,
  DEFAULT_TIMEZONE,
  checkSlug,
} from '../domain/tenant.js';

/**
 * DTOs y validacion de entrada del modulo.
 *
 * La capa de entrada traduce y valida; la REGLA de que forma tiene un slug vive
 * en `domain/`, porque define la URL y el path de la cookie del local. Aca solo
 * se la aplica y se arma el mensaje de error.
 */

const MENSAJES: Record<string, string> = {
  too_short: 'El slug necesita al menos 2 caracteres.',
  too_long: 'El slug no puede pasar de 63 caracteres.',
  bad_format:
    'El slug admite minusculas, numeros y guiones, y no puede empezar ni terminar con guion.',
  reserved: 'Ese slug esta reservado por el sistema.',
};

export const slugSchema = z.string().superRefine((value, ctx) => {
  const problema = checkSlug(value);
  if (problema === null) return;

  ctx.addIssue({
    code: 'custom',
    message: MENSAJES[problema] ?? 'Slug invalido.',
  });
});

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
   * en 0, y 0 significa que todo egreso requiere aprobacion.
   */
  egressLimitAmount: z.coerce.number().min(0).default(0),
  egressShiftLimitAmount: z.coerce.number().min(0).default(0),

  timezone: z.string().min(3).max(64).default(DEFAULT_TIMEZONE),
  businessDayCutoff: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'El corte del dia va como HH:MM.')
    .default(DEFAULT_BUSINESS_DAY_CUTOFF),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
