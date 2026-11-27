-- Plan base de la plataforma.
--
-- `plans` es configuracion de plataforma, no datos de un local, y create_tenant
-- (Fase 1.2) necesita un plan al que asignar cada local nuevo. Por eso la fila
-- viaja en una migracion: sin ella no se puede dar de alta nada.
--
-- Los precios quedan en 0 A PROPOSITO. El modelo (plan base mas sucursales
-- adicionales a precio menor) todavia no se valido con clientes reales, y poner
-- un numero inventado aca lo convertiria en una decision tomada por descuido.
-- Se cargan cuando se definan, sin tocar codigo.
--
-- max_branches = 5 es el maximo de autoservicio; para mas, el cliente contacta.
--
-- Idempotente: si la fila ya existe no se duplica, asi correr la migracion dos
-- veces no deja dos planes "Base".
INSERT INTO plans (id, name, base_price, extra_branch_price, max_branches, features, updated_at)
SELECT gen_random_uuid(), 'Base', 0, 0, 5, '{}'::jsonb, now()
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Base');
