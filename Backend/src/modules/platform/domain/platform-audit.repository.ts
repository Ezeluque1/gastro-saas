import type { Tx } from '../../../shared/db/index.js';

/**
 * Puerto para la auditoria de plataforma.
 *
 * La aplicacion NO tiene permisos sobre `platform_audit_log`, y esta bien que
 * no los tenga: esa tabla registra lo que hace el administrador de plataforma y
 * el uso de las funciones SECURITY DEFINER, no es de ningun local. Por eso la
 * implementacion pasa por la funcion `log_platform_action`.
 */
export interface PlatformAuditPort {
  log(
    tx: Tx,
    data: {
      action: string;
      tenantId?: string | null;
      adminId?: string | null;
      detail?: Record<string, unknown>;
    },
  ): Promise<void>;
}
