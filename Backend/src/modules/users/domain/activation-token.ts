import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de activacion de cuenta, de un solo uso.
 *
 * Reemplaza a mandarle una contrasena temporal al Dueno: con un link, el
 * administrador que da de alta el local nunca conoce su clave.
 *
 * En la base se guarda SOLO el hash. Si alguien leyera la tabla, no podria
 * activar la cuenta.
 *
 * Por que SHA-256 y no argon2: argon2 es para secretos de BAJA entropia, donde
 * el costo de cada intento es la defensa contra la fuerza bruta. Este token son
 * 256 bits aleatorios, asi que no hay nada que adivinar, y un hash lento solo
 * agregaria latencia a cada activacion sin ganar seguridad. Las contrasenas, que
 * son otra cosa, se van a guardar con argon2id en la fase 1.3.
 *
 * docs/Backend: "Alta de locales" (punto 4) y "Recuperacion de contrasena".
 */

/** Cuanto vale el link antes de vencer. */
export const ACTIVATION_TOKEN_TTL_HOURS = 72;

const TOKEN_BYTES = 32;

export interface ActivationToken {
  /** Se muestra una sola vez, en el link. Nunca se guarda. */
  readonly token: string;
  /** Lo unico que va a la base. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export function createActivationToken(now = new Date()): ActivationToken {
  // base64url: entra en una URL sin escapar nada.
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  return {
    token,
    tokenHash: hashActivationToken(token),
    expiresAt: new Date(now.getTime() + ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
  };
}

/**
 * Hash del token, para guardarlo y para compararlo al activar.
 *
 * La comparacion en la fase 1.3 tiene que buscar por este hash, no traer la
 * fila y comparar en memoria.
 */
export function hashActivationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Arma el link que recibe el Dueno.
 *
 * El slug va en el path porque la sesion y la cookie del local viven bajo
 * `/l/{slug}`. La ruta concreta del frontend se confirma al implementar
 * `POST /auth/activate` en la fase 1.4; lo que no cambia es que el token viaja
 * como parametro y el slug en el path.
 */
export function buildActivationLink(
  appOrigin: string,
  slug: string,
  token: string,
): string {
  const base = appOrigin.replace(/\/+$/, '');
  return `${base}/l/${slug}/activar?token=${encodeURIComponent(token)}`;
}
