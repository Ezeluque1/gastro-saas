-- Las funciones SECURITY DEFINER.
--
-- Son la UNICA superficie del sistema que saltea RLS. Por eso son minimas,
-- devuelven solo lo necesario y cada uso queda registrado.
--
-- docs/Backend: "Login y consultas fuera de RLS".
--
-- La tercera funcion que menciona el documento, resolve_tenant_by_wa_phone,
-- no esta: necesita la tabla whatsapp_accounts, que es de la fase 2. No es un
-- olvido, y no se puede crear una funcion que referencie una tabla inexistente.

-- -----------------------------------------------------------------------------
-- Permisos del rol dueno de las funciones
-- -----------------------------------------------------------------------------
-- gastro_definer tiene BYPASSRLS, pero eso saltea las POLITICAS, no los GRANT:
-- arranca sin permisos sobre ninguna tabla. Se le dan exactamente los dos que
-- necesitan las funciones de abajo, y nada mas.
--
-- Si una funcion nueva necesita otro permiso, hay que agregarlo aca
-- explicitamente. Eso es a proposito: obliga a que el cambio se vea en la
-- revision del codigo en vez de pasar inadvertido.
GRANT SELECT ON "tenants" TO gastro_definer;
GRANT INSERT ON "platform_audit_log" TO gastro_definer;

-- -----------------------------------------------------------------------------
-- log_platform_action
-- -----------------------------------------------------------------------------
-- Deja constancia de una accion de plataforma.
--
-- Existe porque la aplicacion NO tiene ningun permiso sobre
-- platform_audit_log, y esta bien que no lo tenga: esa tabla registra lo que
-- hace el administrador de plataforma y el uso de estas funciones, no es de
-- ningun local. Sin esta funcion, la unica alternativa seria darle a la app
-- INSERT sobre la tabla, y entonces un local podria ensuciar la auditoria de
-- la plataforma.
--
-- No devuelve nada util a proposito: no es un canal para leer datos.
CREATE FUNCTION log_platform_action(
  p_action    text,
  p_tenant_id uuid    DEFAULT NULL,
  p_admin_id  uuid    DEFAULT NULL,
  p_detail    jsonb   DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
-- Un SECURITY DEFINER sin search_path fijo es una via de escalada conocida:
-- quien llama podria poner primero un esquema propio y hacer que la funcion
-- use SUS tablas o SUS operadores con privilegios elevados.
SET search_path = pg_catalog, public
AS $$
  INSERT INTO platform_audit_log (id, admin_id, action, tenant_id, detail)
  VALUES (gen_random_uuid(), p_admin_id, p_action, p_tenant_id, coalesce(p_detail, '{}'::jsonb));
$$;

ALTER FUNCTION log_platform_action(text, uuid, uuid, jsonb) OWNER TO gastro_definer;
REVOKE ALL ON FUNCTION log_platform_action(text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_platform_action(text, uuid, uuid, jsonb) TO gastro_app;

-- -----------------------------------------------------------------------------
-- resolve_tenant_by_slug
-- -----------------------------------------------------------------------------
-- Resuelve slug -> (id, estado). Es la primera consulta de todo login, cuando
-- todavia no se sabe a que local pertenece la request.
--
-- Devuelve SOLO el id y el estado. No el nombre, no el plan, no nada mas: todo
-- lo demas se puede leer despues con RLS normal, una vez fijado el contexto.
-- Mantenerla pobre es lo que la hace segura.
--
-- Si el slug no existe devuelve cero filas, sin distinguir de ninguna otra
-- causa. El login tiene que responder el mismo error para local inexistente,
-- usuario inexistente y clave incorrecta, asi que no se pueden enumerar los
-- locales de la plataforma.
--
-- El estado se devuelve porque el login lo necesita: un local cancelado no
-- deja entrar a nadie y uno suspendido solo a Dueno y Encargado en lectura.
CREATE FUNCTION resolve_tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, status tenant_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Cada uso queda registrado. Se escribe ANTES de buscar, para que quede
  -- rastro tambien de los intentos con slugs que no existen: eso es justamente
  -- lo que delata a alguien probando nombres de locales.
  PERFORM log_platform_action('resolve_tenant_by_slug', NULL, NULL,
                              jsonb_build_object('slug', p_slug));

  RETURN QUERY
    SELECT t.id, t.status FROM tenants t WHERE t.slug = p_slug;
END;
$$;

ALTER FUNCTION resolve_tenant_by_slug(text) OWNER TO gastro_definer;
REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO gastro_app;
