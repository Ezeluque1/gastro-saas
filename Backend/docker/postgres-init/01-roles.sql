-- Provisionamiento de roles. Se ejecuta una sola vez, al inicializar el
-- contenedor de PostgreSQL. El CI corre este mismo archivo, asi que local y CI
-- no se van separando.
--
-- Son TRES roles distintos a proposito (docs/Backend: "Migraciones" y "Login y
-- consultas fuera de RLS"):
--
--   gastro_migrator  dueno de las tablas, ejecuta las migraciones.
--
--   gastro_app       con el que se conecta la aplicacion. No es superusuario,
--                    no es dueno de las tablas y NO tiene BYPASSRLS, asi que
--                    las politicas RLS lo alcanzan de verdad.
--
--   gastro_definer   dueno de las dos funciones SECURITY DEFINER, y el unico
--                    rol con BYPASSRLS. Ver abajo por que tiene que existir.
--
-- Los GRANT sobre las tablas no van aca: viajan en las migraciones.

CREATE ROLE gastro_migrator WITH LOGIN PASSWORD 'migrator_dev' CREATEDB;
CREATE ROLE gastro_app WITH LOGIN PASSWORD 'app_dev' NOBYPASSRLS;

-- -----------------------------------------------------------------------------
-- gastro_definer: por que existe
-- -----------------------------------------------------------------------------
-- El login tiene que resolver `slug` -> `tenant_id` ANTES de saber a que local
-- pertenece la request. Es la unica consulta que necesariamente corre fuera de
-- RLS, y por eso se resuelve con una funcion SECURITY DEFINER minima.
--
-- Lo que no es obvio: esa funcion NO puede ser propiedad de gastro_migrator.
-- Con FORCE ROW LEVEL SECURITY las politicas alcanzan tambien al dueno de las
-- tablas, asi que una funcion que corra como migrador falla igual con
-- "unrecognized configuration parameter app.tenant_id". Es circular: el
-- contexto de tenant es justo lo que se esta tratando de averiguar. Se
-- comprobo en la base, no es teoria.
--
-- La salida es un rol aparte con BYPASSRLS que sea dueno SOLO de esas
-- funciones. Es muy distinto de darle BYPASSRLS al rol de la aplicacion, que el
-- documento descarta con razon: ahi cualquier bug saltearia el aislamiento,
-- mientras que aca la superficie privilegiada son dos funciones chicas.
--
-- NOLOGIN: nadie se conecta con este rol, solo se usa como dueno.
--
-- Ojo con un detalle util: BYPASSRLS saltea las POLITICAS, no los GRANT. El rol
-- arranca sin permisos sobre ninguna tabla y la migracion le da exactamente los
-- dos que necesita (SELECT en tenants, INSERT en platform_audit_log). Si una
-- funcion nueva necesita mas, hay que otorgarlo explicitamente, y eso se ve en
-- la revision.
CREATE ROLE gastro_definer WITH NOLOGIN BYPASSRLS;

-- El migrador necesita ser miembro para poder transferirle la propiedad de las
-- funciones (ALTER FUNCTION ... OWNER TO pide ser miembro del rol destino).
--
-- Efecto lateral a tener presente: esto le permite a una migracion hacer
-- SET ROLE gastro_definer y saltear RLS. Es la contracara de FORCE, y de hecho
-- es la via para el backfill que quedo anotado en la migracion de la fase 1.1.
-- La aplicacion NO puede hacerlo: gastro_app no es miembro.
GRANT gastro_definer TO gastro_migrator;

-- Base de datos de desarrollo, propiedad del rol migrador.
CREATE DATABASE gastro OWNER gastro_migrator;

-- Base de datos de pruebas, misma forma.
CREATE DATABASE gastro_test OWNER gastro_migrator;

-- Nadie puede crear objetos en el esquema public salvo su dueno.
\connect gastro
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO gastro_migrator;
GRANT USAGE ON SCHEMA public TO gastro_app;

-- gastro_definer necesita CREATE y no solo USAGE porque
-- `ALTER FUNCTION ... OWNER TO` exige que el dueno nuevo pueda crear objetos en
-- el esquema donde vive la funcion. Es mas de lo que uno querria darle, y se
-- acepta porque el rol es NOLOGIN: nadie se conecta con el, y gastro_app no es
-- miembro, asi que no puede hacer SET ROLE. La alternativa seria un esquema
-- aparte solo para estas funciones, que complica el search_path y las
-- migraciones sin ganar nada practico con dos funciones.
GRANT USAGE, CREATE ON SCHEMA public TO gastro_definer;

\connect gastro_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO gastro_migrator;
GRANT USAGE ON SCHEMA public TO gastro_app;

-- gastro_definer necesita CREATE y no solo USAGE porque
-- `ALTER FUNCTION ... OWNER TO` exige que el dueno nuevo pueda crear objetos en
-- el esquema donde vive la funcion. Es mas de lo que uno querria darle, y se
-- acepta porque el rol es NOLOGIN: nadie se conecta con el, y gastro_app no es
-- miembro, asi que no puede hacer SET ROLE. La alternativa seria un esquema
-- aparte solo para estas funciones, que complica el search_path y las
-- migraciones sin ganar nada practico con dos funciones.
GRANT USAGE, CREATE ON SCHEMA public TO gastro_definer;
