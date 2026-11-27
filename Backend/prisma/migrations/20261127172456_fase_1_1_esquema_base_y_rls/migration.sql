/*
  Warnings:

  - You are about to drop the `schema_check` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "session_kind" AS ENUM ('user', 'support');

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('pilot', 'active', 'past_due', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "pending_payment_policy" AS ENUM ('warn', 'block');

-- CreateEnum
CREATE TYPE "payment_method_type" AS ENUM ('cash', 'card', 'transfer', 'wallet');

-- DropTable
DROP TABLE "schema_check";

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "entity" VARCHAR(60) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" "session_kind" NOT NULL DEFAULT 'user',
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "device" VARCHAR(200),
    "last_used_at" TIMESTAMPTZ(3),
    "support_session_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "base_price" DECIMAL(14,2) NOT NULL,
    "extra_branch_price" DECIMAL(14,2) NOT NULL,
    "max_branches" INTEGER NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'pilot',
    "trial_ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "business_day_cutoff" VARCHAR(5) NOT NULL DEFAULT '05:00',
    "discount_limit_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "egress_limit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "egress_shift_limit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pending_payment_on_deliver" "pending_payment_policy" NOT NULL DEFAULT 'warn',
    "block_on_insufficient_stock" BOOLEAN NOT NULL DEFAULT false,
    "block_close_with_pending" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(250),
    "phone" VARCHAR(40),
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" "payment_method_type" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "tenant_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "login" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(180),
    "email_verified_at" TIMESTAMPTZ(3),
    "password_hash" VARCHAR(255),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_expires_at" TIMESTAMPTZ(3),
    "activation_token_hash" VARCHAR(255),
    "activation_expires_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "template_key" VARCHAR(40),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_code" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branch_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_id_idx" ON "audit_log"("tenant_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_entity_id_idx" ON "audit_log"("tenant_id", "entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_tenant_id_user_id_idx" ON "user_sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "branches_tenant_id_name_idx" ON "branches"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "payment_methods_tenant_id_active_idx" ON "payment_methods"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "cash_registers_tenant_id_branch_id_idx" ON "cash_registers"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_log_tenant_id_created_at_idx" ON "platform_audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "users_tenant_id_active_idx" ON "users"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_login_key" ON "users"("tenant_id", "login");

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "role_permissions_tenant_id_idx" ON "role_permissions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_code_key" ON "role_permissions"("role_id", "permission_code");

-- CreateIndex
CREATE INDEX "user_branch_roles_tenant_id_user_id_idx" ON "user_branch_roles"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "user_branch_roles_tenant_id_branch_id_idx" ON "user_branch_roles"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "password_reset_codes_tenant_id_user_id_created_at_idx" ON "password_reset_codes"("tenant_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_roles" ADD CONSTRAINT "user_branch_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_roles" ADD CONSTRAINT "user_branch_roles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_roles" ADD CONSTRAINT "user_branch_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Todo lo que sigue se agrego a mano: Prisma no modela politicas RLS, CHECK ni
-- indices con NULLS NOT DISTINCT. La migracion se genero con --create-only.
--
-- RLS es la SEGUNDA barrera del aislamiento. La primera es que toda consulta de
-- negocio pasa por withTenant(), que abre una transaccion y fija
-- app.tenant_id. Si manana un filtro `where tenantId` se escribe mal, la base
-- igual no deja ver datos de otro local.
--
-- docs/Backend: "Multitenancy y aislamiento de datos" y "Migraciones".

-- -----------------------------------------------------------------------------
-- Politicas por tabla
-- -----------------------------------------------------------------------------
-- Se aplican en un bucle sobre una lista explicita a proposito: garantiza que
-- TODAS las tablas reciban exactamente el mismo tratamiento. Escribir 11 bloques
-- a mano invita a que a una le falte el WITH CHECK, y justamente esa es la
-- omision que deja insertar filas con el tenant_id de otro local.
--
-- Tres cosas que deciden si esto sirve o no:
--
--   1. FORCE no es opcional. Sin FORCE, el dueno de las tablas
--      (gastro_migrator) se saltea las politicas.
--   2. USING filtra lo que se lee, actualiza y borra; WITH CHECK valida lo que
--      se inserta. Postgres usa la expresion de USING tambien como WITH CHECK
--      cuando esta se omite, asi que con USING sola el aislamiento de escritura
--      YA funciona: se comprobo quitando el WITH CHECK de una tabla y las
--      pruebas siguieron pasando. Se escriben las dos igual, porque deja la
--      intencion explicita y no se rompe si manana se agregan politicas por
--      comando (FOR SELECT, FOR INSERT), donde la omision si importaria.
--   3. current_setting('app.tenant_id') va SIN el segundo argumento: si el
--      parametro no esta fijado, la consulta falla con error en vez de
--      devolver cero filas en silencio. Un bug que saltea withTenant() tiene
--      que romper, no pasar desapercibido.
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'tenant_settings',
    'branches',
    'payment_methods',
    'cash_registers',
    'users',
    'roles',
    'role_permissions',
    'user_branch_roles',
    'password_reset_codes',
    'user_sessions',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
  END LOOP;
END $$;

-- `tenants` es el caso especial: su politica compara `id`, porque el id ES el
-- tenant. Por eso resolver el slug durante el login no se puede hacer con una
-- consulta normal y necesita una funcion SECURITY DEFINER (Fase 1.2).
--
-- El WITH CHECK obliga a que create_tenant fije app.tenant_id con el id nuevo
-- ANTES de insertar la fila. Es incomodo a proposito: evita darle BYPASSRLS a
-- nadie.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants"
  USING (id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (id = current_setting('app.tenant_id')::uuid);

-- -----------------------------------------------------------------------------
-- Las dos tablas que NO llevan RLS de tenant
-- -----------------------------------------------------------------------------
-- `plans` es configuracion compartida de la plataforma: todos los locales la
-- leen, ninguno la escribe.
REVOKE INSERT, UPDATE, DELETE ON "plans" FROM gastro_app;

-- `platform_audit_log` registra acciones del administrador de plataforma y cada
-- uso de las funciones SECURITY DEFINER. No es de ningun local y la aplicacion
-- no tiene nada que hacer ahi: se le revoca todo.
--
-- Las funciones SECURITY DEFINER escriben aca corriendo como su dueno
-- (gastro_migrator), asi que no necesitan este GRANT.
REVOKE ALL ON "platform_audit_log" FROM gastro_app;

-- -----------------------------------------------------------------------------
-- Restricciones de integridad
-- -----------------------------------------------------------------------------

-- El slug forma parte de la URL y de la cookie, asi que se valida como nombre
-- DNS desde el primer dia: minusculas, numeros y guiones, sin empezar ni
-- terminar con guion, y sin palabras reservadas que choquen con los subdominios
-- del sistema.
ALTER TABLE "tenants" ADD CONSTRAINT tenants_slug_format CHECK (
  slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  AND length(slug) BETWEEN 2 AND 63
  AND slug NOT IN ('admin', 'api', 'www', 'app', 'static', 'support')
);

-- Una sesion de soporte no pertenece a ningun usuario del local; una de usuario
-- siempre tiene uno. Sin este CHECK, un bug podria crear una sesion de usuario
-- sin dueno, que es una sesion que pasa la validacion y no se puede atribuir.
ALTER TABLE "user_sessions" ADD CONSTRAINT user_sessions_kind_user CHECK (
  (kind = 'support' AND user_id IS NULL)
  OR (kind = 'user' AND user_id IS NOT NULL)
);

-- Horario de corte del dia comercial, como "HH:MM" de 24 horas.
ALTER TABLE "tenant_settings" ADD CONSTRAINT tenant_settings_cutoff_format CHECK (
  business_day_cutoff ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
);

-- Los topes no pueden ser negativos, y el de descuento es un porcentaje.
-- 0 es un valor valido y significativo en los tres: tope 0 quiere decir que
-- todo requiere aprobacion.
ALTER TABLE "tenant_settings" ADD CONSTRAINT tenant_settings_limits_range CHECK (
  discount_limit_percent BETWEEN 0 AND 100
  AND egress_limit_amount >= 0
  AND egress_shift_limit_amount >= 0
);

-- Un usuario no puede tener dos veces el mismo rol en la misma sucursal.
--
-- Hace falta NULLS NOT DISTINCT porque branch_id nulo significa "todas las
-- sucursales": con la semantica normal de Postgres, dos filas con NULL se
-- consideran distintas y se podria asignar dos veces el mismo rol global.
-- Prisma todavia no modela esta variante del indice unico.
CREATE UNIQUE INDEX user_branch_roles_unique
  ON "user_branch_roles" (tenant_id, user_id, branch_id, role_id) NULLS NOT DISTINCT;

-- El email del Dueno identifica su cuenta para la recuperacion por email, asi
-- que no puede repetirse dentro del local. Parcial: los usuarios sin email
-- (recepcion, delivery) no entran en el indice.
CREATE UNIQUE INDEX users_tenant_email_unique
  ON "users" (tenant_id, lower(email)) WHERE email IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Nota para migraciones futuras
-- -----------------------------------------------------------------------------
-- Con FORCE ROW LEVEL SECURITY las politicas alcanzan tambien a
-- gastro_migrator, que es quien corre las migraciones. Una migracion que
-- necesite tocar datos de todos los locales a la vez (un backfill) NO va a
-- poder: va a ver cero filas o fallar porque app.tenant_id no esta fijado.
--
-- Cuando pase, la migracion tiene que desactivar el forzado para esa tabla,
-- hacer el backfill y volver a activarlo en la MISMA migracion:
--
--   ALTER TABLE x NO FORCE ROW LEVEL SECURITY;
--   -- backfill
--   ALTER TABLE x FORCE ROW LEVEL SECURITY;
--
-- Nunca dejarlo desactivado.
