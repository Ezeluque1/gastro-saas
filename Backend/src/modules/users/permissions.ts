/**
 * Catalogo de permisos y plantilla de roles.
 *
 * El catalogo vive en el codigo, no en una tabla: es parte del contrato de la
 * API y tiene que poder versionarse junto a los endpoints que lo exigen.
 * `role_permissions` guarda el codigo como texto.
 *
 * La funcion puede(usuario, permiso, sucursal) y su middleware son Fase 2.
 * Aca solo esta el catalogo y la plantilla que create_tenant (Fase 1.2) copia
 * a cada local nuevo.
 *
 * docs/Backend: "Catalogo inicial de permisos" y "Permisos por defecto de cada
 * rol".
 */

/**
 * Todos los permisos del sistema.
 *
 * Agregar uno aca no se lo da a nadie: hace falta una migracion que lo sume a
 * los roles que correspondan en los locales ya creados, porque cambiar la
 * plantilla NO modifica los roles existentes.
 */
export const PERMISSIONS = {
  // Pedidos
  'orders.view': 'Ver pedidos (el repartidor solo los de sus salidas)',
  'orders.create': 'Tomar pedidos',
  'orders.edit': 'Editar pedidos',
  'orders.change_status': 'Cambiar estados desde recepcion',
  'orders.print': 'Imprimir y reimprimir comandas, tickets y precuentas',
  'orders.deliver': 'Marcar Entregado o No entregado',
  'orders.revert_undelivered': 'Revertir un No entregado, con motivo',
  'orders.cancel': 'Cancelar con motivo en Recibido o En preparacion',
  'orders.cancel_late': 'Cancelar en Listo o En camino',
  'orders.discount': 'Aplicar descuentos manuales hasta el tope del local',
  'orders.discount_over_limit': 'Aprobar un descuento que supera el tope',
  'orders.backdate': 'Cargar un pedido despues, dentro del turno abierto',
  'orders.backdate_any': 'Cargar un pedido de un turno cerrado o un dia anterior',

  // Delivery
  'delivery.assign': 'Armar salidas y asignar repartidor',
  'settlements.create': 'Rendir repartidores',

  // Caja
  'cash.open': 'Abrir caja',
  'cash.close': 'Cerrar caja',
  'cash.reopen': 'Reabrir una caja cerrada',
  'cash.movements': 'Ingresos y egresos manuales, hasta el tope por egreso',
  'cash.movements_over_limit': 'Aprobar un egreso que supera el tope',
  'cash.owner_withdrawal': 'Registrar un retiro del dueno',

  // Stock e insumos
  'stock.view': 'Ver stock',
  'stock.adjust': 'Ajustar stock',
  'supplies.create': 'Alta rapida de insumos y codigos de barras',

  // Catalogo y precios
  'catalog.manage': 'Productos, variantes, extras y categorias',
  'prices.edit': 'Ajustes de precio individuales, por categoria y generales',

  // Reportes y datos
  'reports.view': 'Ver reportes',
  'audit.view': 'Ver el historial de auditoria',
  'data.export': 'Exportar datos a CSV',

  // Usuarios y configuracion
  'users.manage': 'Crear, editar y dar de baja usuarios',
  'users.reset_password': 'Restablecer la clave de otro usuario',
  'roles.manage': 'Crear y editar roles y sus permisos',
  'settings.manage': 'Configuracion del local, sucursales y medios de pago',

  // WhatsApp (fase 2)
  'whatsapp.inbox': 'Atender la bandeja de WhatsApp',
} as const;

/** Codigo de permiso. Cualquier string que no este en el catalogo no compila. */
export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

/**
 * Permisos que valen para TODO el local y no por sucursal.
 *
 * Solo se cumplen si el usuario tiene el rol asignado en todas las sucursales
 * (`user_branch_roles.branch_id` nulo), porque el precio y la configuracion son
 * unicos para el local: un Encargado de una sucursal no puede cambiar el precio
 * que ven las demas.
 *
 * Lo usa puede() en la Fase 2.
 */
export const TENANT_WIDE_PERMISSIONS: readonly Permission[] = [
  'prices.edit',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'data.export',
];

/* -------------------------------------------------------------------------- */
/* Plantilla de roles                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Clave estable de cada rol de la plantilla.
 *
 * Se guarda en `roles.template_key` para poder reconocerlos desde el codigo
 * aunque el Dueno les cambie el nombre.
 *
 * Cocina no tiene rol en el MVP: se entera por la comanda impresa.
 */
export const ROLE_TEMPLATE_KEYS = ['owner', 'manager', 'cashier', 'courier'] as const;

export type RoleTemplateKey = (typeof ROLE_TEMPLATE_KEYS)[number];

export interface RoleTemplate {
  readonly key: RoleTemplateKey;
  readonly name: string;
  /** Rol protegido: no se puede borrar ni renombrar. */
  readonly isSystem: boolean;
  /**
   * Permisos que se copian a `role_permissions` al crear el local.
   *
   * El Dueno es la excepcion: va vacio porque sus permisos se calculan en el
   * codigo (ver OWNER_HAS_ALL_PERMISSIONS).
   */
  readonly permissions: readonly Permission[];
}

/**
 * El Dueno tiene todos los permisos, y NO se guardan fila por fila.
 *
 * Es deliberado: asi un permiso nuevo del catalogo le llega solo, sin migrar
 * datos y sin riesgo de que un local quede con un Dueno al que le falta algo.
 * puede() tiene que resolverlo por `template_key === 'owner'`, no mirando
 * role_permissions.
 */
export const OWNER_HAS_ALL_PERMISSIONS = true;

/**
 * Lo que create_tenant copia a cada local nuevo.
 *
 * Cambiar esta plantilla NO modifica los roles de los locales ya creados: para
 * eso va una migracion.
 *
 * El alcance del Encargado (su sucursal) y del repartidor (sus salidas) no se
 * expresa aca, sino en la asignacion por sucursal y en el filtro por
 * `delivery_runs.courier_id`.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: 'owner',
    name: 'Dueño',
    isSystem: true,
    permissions: [],
  },
  {
    key: 'manager',
    name: 'Encargado',
    isSystem: true,
    permissions: [
      'orders.view',
      'orders.create',
      'orders.edit',
      'orders.change_status',
      'orders.print',
      'orders.deliver',
      'orders.revert_undelivered',
      'orders.cancel',
      'orders.cancel_late',
      'orders.discount',
      'orders.discount_over_limit',
      'orders.backdate',
      'orders.backdate_any',
      'delivery.assign',
      'settlements.create',
      'whatsapp.inbox',
      'cash.open',
      'cash.close',
      'cash.movements',
      'cash.movements_over_limit',
      'stock.view',
      'stock.adjust',
      'supplies.create',
      'catalog.manage',
      'reports.view',
      'audit.view',
      'users.reset_password',
    ],
  },
  {
    key: 'cashier',
    name: 'Recepcionista / Cajero',
    isSystem: true,
    permissions: [
      'orders.view',
      'orders.create',
      'orders.edit',
      'orders.change_status',
      'orders.print',
      'orders.deliver',
      'orders.cancel',
      'orders.discount',
      'orders.backdate',
      'delivery.assign',
      'settlements.create',
      'whatsapp.inbox',
      'cash.open',
      'cash.close',
      'cash.movements',
      'stock.view',
    ],
  },
  {
    key: 'courier',
    name: 'Delivery',
    isSystem: true,
    // Solo ve y actua sobre los pedidos de sus propias salidas. De cada pedido
    // ve nombre, direccion, telefono, notas, monto y medio de pago: nada de
    // caja, stock ni pedidos de otros repartidores.
    permissions: ['orders.view', 'orders.deliver'],
  },
];

/**
 * `cash.owner_withdrawal` no esta en ningun rol de la plantilla salvo el Dueno
 * (que lo tiene por calculo). El Dueno se lo puede dar al Encargado despues, a
 * mano. Se deja anotado para que no parezca un olvido.
 */
export const PERMISSIONS_NOT_IN_TEMPLATE: readonly Permission[] = [
  'cash.owner_withdrawal',
];
