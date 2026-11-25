/**
 * Errores de negocio con un codigo estable.
 *
 * `code` es el identificador que usa el frontend para decidir; `detail` es un
 * texto en espanol para mostrar o registrar y puede cambiar sin romper nada.
 * Dentro de v1 los codigos no se renombran.
 *
 * docs/Backend: "Manejo de errores" y "Formato de errores".
 */

/** Un campo invalido, dentro de un `validation_error`. */
export interface FieldIssue {
  /** JSON Pointer al campo del cuerpo (RFC 6901). Ej: "/items/0/quantity". */
  readonly pointer?: string;
  /** Nombre del parametro, cuando el problema esta en la query. */
  readonly parameter?: string;
  readonly code: string;
  readonly detail: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  /** Miembros extra que se agregan tal cual a la respuesta problem+json. */
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(args: {
    status: number;
    code: string;
    title: string;
    detail: string;
    extra?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(args.detail, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = new.target.name;
    this.status = args.status;
    this.code = args.code;
    this.title = args.title;
    this.extra = Object.freeze({ ...args.extra });
  }

  /** El texto que va en el miembro `detail` de la respuesta. */
  get detail(): string {
    return this.message;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/* -------------------------------------------------------------------------- */
/* 400                                                                        */
/* -------------------------------------------------------------------------- */

/** Cuerpo, ruta o query invalidos, incluidos los parametros desconocidos. */
export class ValidationError extends AppError {
  constructor(errors: readonly FieldIssue[], detail = 'Revisa los campos marcados.') {
    super({
      status: 400,
      code: 'validation_error',
      title: 'Datos invalidos',
      detail,
      extra: { errors },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 401                                                                        */
/* -------------------------------------------------------------------------- */

/** Sin sesion, sesion vencida o revocada. El frontend vuelve al login. */
export class UnauthenticatedError extends AppError {
  constructor(detail = 'Inicia sesion para continuar.') {
    super({ status: 401, code: 'unauthenticated', title: 'No autenticado', detail });
  }
}

/**
 * Login fallido. Es el MISMO error si el local no existe, el usuario no existe
 * o la clave es incorrecta, para no revelar que locales ni que usuarios hay.
 * No acepta un detail propio justamente para que no se filtre la diferencia.
 */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'invalid_credentials',
      title: 'Credenciales invalidas',
      detail: 'Usuario o contrasena incorrectos.',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 403                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Falta un permiso, o el local de la sesion no coincide con el slug de la ruta.
 * Los descuentos y egresos que superan el tope NO tienen codigo propio:
 * responden aca, con el permiso y el tope vigente.
 */
export class PermissionDeniedError extends AppError {
  constructor(args: {
    permission: string;
    detail?: string;
    /** `tenant_mismatch` cuando el slug no coincide con la sesion. */
    reason?: string;
    /** Tope vigente, cuando el permiso es de los que tienen tope. */
    limit?: string;
  }) {
    super({
      status: 403,
      code: 'permission_denied',
      title: 'Sin permiso',
      detail: args.detail ?? 'No tenes permiso para esta accion.',
      extra: {
        permission: args.permission,
        ...(args.reason === undefined ? {} : { reason: args.reason }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      },
    });
  }
}

/** Local suspendido: Dueno y Encargado pueden leer, pero no escribir. */
export class TenantSuspendedError extends AppError {
  constructor(detail = 'El local esta suspendido: no se pueden registrar cambios.') {
    super({ status: 403, code: 'tenant_suspended', title: 'Local suspendido', detail });
  }
}

/** Escritura que no pasa la verificacion de origen. */
export class CsrfRejectedError extends AppError {
  constructor(detail = 'No se pudo verificar el origen del pedido.') {
    super({ status: 403, code: 'csrf_rejected', title: 'Origen rechazado', detail });
  }
}

/* -------------------------------------------------------------------------- */
/* 404                                                                        */
/* -------------------------------------------------------------------------- */

/** No existe, o es de otro local. Con RLS no se distingue, y esta bien asi. */
export class NotFoundError extends AppError {
  constructor(detail = 'No se encontro el recurso.') {
    super({ status: 404, code: 'not_found', title: 'No encontrado', detail });
  }
}

/* -------------------------------------------------------------------------- */
/* 409                                                                        */
/* -------------------------------------------------------------------------- */

/** La `version` enviada no es la actual (edicion simultanea). */
export class VersionConflictError extends AppError {
  constructor(currentVersion: number) {
    super({
      status: 409,
      code: 'version_conflict',
      title: 'Conflicto de version',
      detail: 'Alguien mas modifico este registro. Volve a cargarlo.',
      extra: { currentVersion },
    });
  }
}

/** Clave unica duplicada. */
export class AlreadyExistsError extends AppError {
  constructor(detail = 'Ya existe un registro con esos datos.') {
    super({ status: 409, code: 'already_exists', title: 'Ya existe', detail });
  }
}

/* -------------------------------------------------------------------------- */
/* 413, 415, 429                                                              */
/* -------------------------------------------------------------------------- */

export class PayloadTooLargeError extends AppError {
  constructor(detail = 'El contenido enviado es demasiado grande.') {
    super({
      status: 413,
      code: 'payload_too_large',
      title: 'Contenido muy grande',
      detail,
    });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(detail = 'El cuerpo del pedido debe ser application/json.') {
    super({
      status: 415,
      code: 'unsupported_media_type',
      title: 'Tipo de contenido no soportado',
      detail,
    });
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super({
      status: 429,
      code: 'rate_limited',
      title: 'Demasiados pedidos',
      detail: 'Espera unos segundos y volve a intentar.',
      extra: { retryAfterSeconds },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 422: reglas de negocio                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Base de las reglas de negocio. Cada modulo define las suyas con su codigo en
 * snake_case (`cash_session_closed`, `whatsapp_window_closed`, ...) y las suma
 * a la tabla central de codigos del documento.
 */
export class BusinessRuleError extends AppError {
  constructor(args: {
    code: string;
    detail: string;
    title?: string;
    extra?: Record<string, unknown>;
  }) {
    super({
      status: 422,
      code: args.code,
      title: args.title ?? 'Operacion no permitida',
      detail: args.detail,
      ...(args.extra === undefined ? {} : { extra: args.extra }),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 500, 503                                                                   */
/* -------------------------------------------------------------------------- */

/** Base de datos caida o mantenimiento. */
export class ServiceUnavailableError extends AppError {
  constructor(detail = 'El servicio no esta disponible en este momento.') {
    super({
      status: 503,
      code: 'service_unavailable',
      title: 'Servicio no disponible',
      detail,
    });
  }
}
