-- Migracion inicial.
--
-- Generada con `prisma migrate dev --create-only` y completada a mano: los
-- permisos del rol de la aplicacion no los modela Prisma y viajan aca, no se
-- configuran a mano en cada entorno.
--
-- La ejecuta el rol migrador (gastro_migrator), que es el dueno de las tablas.
-- La aplicacion se conecta con gastro_app, que no es dueno de nada.
--
-- docs/Backend: "Migraciones" y "Multitenancy y aislamiento de datos".

-- -----------------------------------------------------------------------------
-- Tabla de control
-- -----------------------------------------------------------------------------
-- Existe para verificar de punta a punta que el pipeline de migraciones
-- funciona y que el rol de la aplicacion tiene los permisos que corresponden.
-- No tiene tenant_id y por eso no lleva RLS: es la unica tabla asi.
--
-- Desde la Fase 1 TODA tabla de negocio lleva tenant_id, ENABLE + FORCE ROW
-- LEVEL SECURITY y su politica tenant_isolation.
CREATE TABLE "schema_check" (
    "id" UUID NOT NULL,
    "note" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_check_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- Permisos del rol de la aplicacion
-- -----------------------------------------------------------------------------
-- El rol de la aplicacion puede leer y escribir datos, pero NO puede alterar
-- el esquema: nada de CREATE, ALTER ni DROP. Las migraciones son el unico
-- camino para cambiar la estructura.

GRANT USAGE ON SCHEMA public TO gastro_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gastro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gastro_app;

-- Lo mismo para las tablas que creen las migraciones futuras, asi no hay que
-- repetir el GRANT en cada una (y no se olvida).
ALTER DEFAULT PRIVILEGES FOR ROLE gastro_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gastro_app;

ALTER DEFAULT PRIVILEGES FOR ROLE gastro_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO gastro_app;

-- La aplicacion no necesita ejecutar funciones por defecto. Las tres funciones
-- SECURITY DEFINER que si necesita (resolve_tenant_by_slug,
-- resolve_tenant_by_wa_phone y create_tenant) reciben su GRANT una por una en
-- la migracion de la Fase 1, para que quede explicito que puede ejecutar.
ALTER DEFAULT PRIVILEGES FOR ROLE gastro_migrator IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
