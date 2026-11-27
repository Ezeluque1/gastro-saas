import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  OWNER_HAS_ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSIONS_NOT_IN_TEMPLATE,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_KEYS,
  TENANT_WIDE_PERMISSIONS,
  isPermission,
} from '../../src/modules/users/permissions.js';

/**
 * El catalogo de permisos y la plantilla de roles.
 *
 * Importa probarlo aunque todavia no haya logica que los use: la plantilla la
 * copia create_tenant al dar de alta un local, asi que un error aca no se
 * descubriria escribiendo codigo, sino recien al crear un local real y notar
 * que a un rol le falta algo.
 *
 * docs/Backend: "Catalogo inicial de permisos" y "Permisos por defecto de cada
 * rol".
 */

describe('catalogo de permisos', () => {
  it('no tiene codigos repetidos', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('cada permiso tiene una descripcion util', () => {
    for (const code of ALL_PERMISSIONS) {
      expect(PERMISSIONS[code].length, `descripcion de ${code}`).toBeGreaterThan(5);
    }
  });

  it('todos los codigos usan el formato dominio.accion en snake_case', () => {
    // El formato es parte del contrato: el frontend los recibe en
    // permission_denied y los reportes los registran.
    for (const code of ALL_PERMISSIONS) {
      expect(code, `formato de ${code}`).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('isPermission reconoce los del catalogo y rechaza el resto', () => {
    expect(isPermission('orders.create')).toBe(true);
    expect(isPermission('orders.crear')).toBe(false);
    expect(isPermission('')).toBe(false);
    // Un typo plausible: el documento usa `orders.revert_undelivered`.
    expect(isPermission('orders.revert_not_delivered')).toBe(false);
  });
});

describe('plantilla de roles', () => {
  it('tiene los cuatro roles del documento, sin Cocina', () => {
    // Cocina no usa el sistema en el MVP: se entera por la comanda impresa.
    expect(ROLE_TEMPLATES.map((r) => r.key)).toEqual([...ROLE_TEMPLATE_KEYS]);
    expect(ROLE_TEMPLATES).toHaveLength(4);
  });

  it('solo referencia permisos que existen en el catalogo', () => {
    // Es la prueba que justifica este archivo. Un typo en la plantilla se
    // descubriria recien al dar de alta un local, con el rol incompleto.
    const invalidos = ROLE_TEMPLATES.flatMap((role) =>
      role.permissions
        .filter((p) => !isPermission(p))
        .map((p) => `${role.key}: ${String(p)}`),
    );

    expect(invalidos).toEqual([]);
  });

  it('ningun rol repite un permiso', () => {
    for (const role of ROLE_TEMPLATES) {
      expect(new Set(role.permissions).size, `${role.key} repite permisos`).toBe(
        role.permissions.length,
      );
    }
  });

  it('los cuatro roles son de sistema', () => {
    // Protegidos: no se pueden borrar ni renombrar.
    for (const role of ROLE_TEMPLATES) {
      expect(role.isSystem, role.key).toBe(true);
    }
  });

  it('el Dueno no guarda permisos fila por fila', () => {
    // Se calculan en el codigo, asi un permiso nuevo del catalogo le llega solo
    // sin migrar datos. Si algun dia esta lista deja de estar vacia, puede()
    // tiene que seguir resolviendolo por template_key y no por la tabla.
    const owner = ROLE_TEMPLATES.find((r) => r.key === 'owner');

    expect(owner?.permissions).toEqual([]);
    expect(OWNER_HAS_ALL_PERMISSIONS).toBe(true);
  });

  it('el repartidor solo ve y entrega sus pedidos', () => {
    // No ve caja, ni stock, ni pedidos de otros repartidores. El alcance "sus
    // salidas" no se expresa con un permiso, sino filtrando por courier_id.
    const courier = ROLE_TEMPLATES.find((r) => r.key === 'courier');

    expect(courier?.permissions).toEqual(['orders.view', 'orders.deliver']);
  });

  it('solo el Dueno tiene los permisos de todo el local', () => {
    // prices.edit, users.manage, roles.manage, settings.manage y data.export
    // afectan al local entero: el precio y la configuracion son unicos.
    const deOtros = ROLE_TEMPLATES.filter((r) => r.key !== 'owner').flatMap((role) =>
      role.permissions
        .filter((p) => TENANT_WIDE_PERMISSIONS.includes(p))
        .map((p) => `${role.key}: ${p}`),
    );

    expect(deOtros).toEqual([]);
  });

  it('los permisos de aprobacion no los tiene el Recepcionista', () => {
    // El sentido de los topes es que lo que los supera lo apruebe otro. Si el
    // Recepcionista tuviera el permiso de aprobacion, el tope no serviria.
    const cashier = ROLE_TEMPLATES.find((r) => r.key === 'cashier');

    expect(cashier?.permissions).not.toContain('orders.discount_over_limit');
    expect(cashier?.permissions).not.toContain('cash.movements_over_limit');
    expect(cashier?.permissions).not.toContain('orders.backdate_any');
    expect(cashier?.permissions).not.toContain('orders.cancel_late');
    expect(cashier?.permissions).not.toContain('orders.revert_undelivered');
  });

  it('solo el Dueno puede reabrir una caja', () => {
    const conReopen = ROLE_TEMPLATES.filter((r) => r.permissions.includes('cash.reopen'));

    expect(conReopen).toEqual([]);
  });

  it('cada permiso del catalogo esta en algun rol, o declarado como excepcion', () => {
    // Una lista blanca explicita evita dos cosas: que un permiso quede
    // huerfano por olvido, y que alguien lo agregue a un rol "para que no
    // falte" sin pensarlo.
    const enPlantilla = new Set(ROLE_TEMPLATES.flatMap((r) => r.permissions));

    // El Dueno los tiene todos por calculo, asi que la cuenta se hace sobre los
    // otros tres roles.
    const huerfanos = ALL_PERMISSIONS.filter(
      (p) => !enPlantilla.has(p) && !PERMISSIONS_NOT_IN_TEMPLATE.includes(p),
    );

    // Los que quedan solo para el Dueno son legitimos: se listan para que el
    // cambio sea visible si alguien los mueve.
    expect(huerfanos.sort()).toEqual(
      [
        'cash.reopen',
        'data.export',
        'prices.edit',
        'roles.manage',
        'settings.manage',
        'users.manage',
      ].sort(),
    );
  });
});
