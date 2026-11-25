-- Provisionamiento de roles. Se ejecuta una sola vez, al inicializar el
-- contenedor de PostgreSQL.
--
-- Son dos roles distintos a proposito (docs/Backend: "Migraciones"):
--   gastro_migrator  dueno de las tablas, ejecuta las migraciones.
--   gastro_app       con el que se conecta la aplicacion. No es superusuario,
--                    no es dueno de las tablas y NO tiene BYPASSRLS, asi que
--                    las politicas RLS lo alcanzan de verdad.
--
-- Los GRANT sobre las tablas no van aca: viajan en las migraciones.

CREATE ROLE gastro_migrator WITH LOGIN PASSWORD 'migrator_dev' CREATEDB;
CREATE ROLE gastro_app WITH LOGIN PASSWORD 'app_dev' NOBYPASSRLS;

-- Base de datos de desarrollo, propiedad del rol migrador.
CREATE DATABASE gastro OWNER gastro_migrator;

-- Base de datos de pruebas, misma forma.
CREATE DATABASE gastro_test OWNER gastro_migrator;

-- Nadie puede crear objetos en el esquema public salvo su dueno.
\connect gastro
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO gastro_migrator;
GRANT USAGE ON SCHEMA public TO gastro_app;

\connect gastro_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO gastro_migrator;
GRANT USAGE ON SCHEMA public TO gastro_app;
