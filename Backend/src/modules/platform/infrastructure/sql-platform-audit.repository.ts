import type { PlatformAuditPort } from '../domain/platform-audit.repository.js';

/**
 * Implementacion de `PlatformAuditPort`.
 *
 * SQL crudo porque no hay alternativa: llama a la funcion SECURITY DEFINER
 * `log_platform_action`, y Prisma Client no modela llamadas a funciones. No es
 * una consulta sobre una tabla, asi que el cliente tipado no aplica.
 */
export const sqlPlatformAudit: PlatformAuditPort = {
  async log(tx, data): Promise<void> {
    await tx.$executeRaw`
      SELECT log_platform_action(
        ${data.action},
        ${data.tenantId ?? null}::uuid,
        ${data.adminId ?? null}::uuid,
        ${JSON.stringify(data.detail ?? {})}::jsonb
      )
    `;
  },
};
