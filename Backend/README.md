# Backend — Sistema de gestión gastronómica (SaaS multitenant)

Monolito modular en Node.js, TypeScript, Express 5, PostgreSQL y Prisma 7.

La fuente de verdad es `../docs/`: el documento del MVP (producto), el del
Backend (arquitectura y contrato de la API) y el plan de fases. **Si el código y
los documentos no coinciden, manda el documento** — y hay que actualizar el
documento si algo cambió al implementarlo.

Estado actual: **Fase 0**, **1.1** (esquema y aislamiento) y **1.2**
(`create_tenant`) cerradas. Siguen la 1.3 (login y sesiones) y la 1.4 (ciclo de
claves y estados del local).

## Arranque

Hace falta Node 22.19 o superior (el documento fija Node 24; ver "Pendientes")
y Docker.

```bash
cp .env.example .env
cp .env.test.example .env.test
npm install
npm run test:local          # levanta Postgres, migra y corre las 121 pruebas
```

`test:local` es el comando que levanta todo: arranca el contenedor, espera su
healthcheck, aplica las migraciones en la base de pruebas y corre Vitest. Sirve
para verificar de cero que el entorno quedo bien.

Para levantar el servidor:

```bash
npm run db:up               # Postgres 18 en el puerto 5434
npm run db:deploy           # migraciones en la base de desarrollo
npm run dev
curl -i http://localhost:3000/health
```

Los dos `cp` son `copy` en PowerShell. El resto corre igual en cualquier shell:
los scripts de npm no dependen de la sintaxis de variables de entorno, que es
distinta en bash y en PowerShell.

El puerto es 5434 y no el 5432 habitual para no chocar con otros PostgreSQL ya
instalados en la máquina.

## Comandos

| Comando                   | Qué hace                                                          |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run dev`             | Servidor con recarga (`tsx watch`)                                |
| `npm run build`           | Compila a `dist/`                                                 |
| `npm run typecheck`       | `tsc --noEmit`                                                    |
| `npm run lint`            | ESLint, incluidas las reglas de modularidad                       |
| `npm run format`          | Prettier                                                          |
| `npm test`                | Vitest contra PostgreSQL real (la base ya tiene que estar arriba) |
| `npm run test:local`      | Levanta Postgres, migra y corre las pruebas                       |
| `npm run coverage`        | Pruebas con cobertura                                             |
| `npm run db:up`           | Levanta Postgres y espera su healthcheck                          |
| `npm run db:down`         | Baja el contenedor                                                |
| `npm run db:migrate`      | Crea y aplica una migración (desarrollo)                          |
| `npm run db:deploy`       | Aplica las migraciones existentes                                 |
| `npm run db:deploy:test`  | Igual, sobre la base de pruebas                                   |
| `npm run db:reset`        | Borra y recrea la base de desarrollo                              |
| `npm run monitoring:test` | Fuerza un error para verificar el monitoreo                       |
| `npm run create-tenant`   | Da de alta un local (`-- --help` para ver las opciones)           |

## Lo que ya está en pie

**Aislamiento.** `withTenant()` (`src/shared/db/with-tenant.ts`) es el único
camino a la base para las consultas de negocio: abre una transacción y fija
`app.tenant_id` con `set_config(..., true)`. El `true` es lo que hace que el
valor viva solo en esa transacción; sin él quedaría pegado a la conexión del
pool y la request siguiente arrancaría con el tenant de otro local.
`tests/integration/with-tenant.test.ts` cubre exactamente eso, y se verificó
que la prueba **falla** si alguien cambia ese argumento.

Las políticas RLS ya están: 12 tablas con `ENABLE` **y** `FORCE ROW LEVEL
SECURITY`, cada una con su política `tenant_isolation`.
`tests/integration/tenant-isolation.test.ts` siembra dos locales y verifica que
ninguno lea, modifique, borre ni **inserte** filas del otro, que una consulta
sin contexto falle en vez de devolver cero filas, y que el aislamiento aguante
aunque el filtro de la aplicación esté roto.

Hay además pruebas que leen el catálogo de Postgres, y no son redundantes:
`FORCE` solo cambia algo para el dueño de las tablas, y las pruebas corren como
`gastro_app`, que no lo es. Se comprobó que quitando `FORCE` las pruebas de
comportamiento siguen pasando — de ahí que haga falta mirar `pg_class`. Esa
prueba descubre la lista de tablas de la base, así que una tabla nueva con
`tenant_id` a la que se le olvide la política rompe la prueba sola.

El rol de la aplicación no es superusuario, no es dueño de las tablas, no tiene
`BYPASSRLS` y no puede alterar el esquema.

**Tres roles de base.** `gastro_migrator` es dueño de las tablas y ejecuta las
migraciones (`DATABASE_MIGRATION_URL`, que usa solo la CLI de Prisma).
`gastro_app` es el rol de la aplicación (`DATABASE_URL`). Y `gastro_definer`,
con `BYPASSRLS` y sin `LOGIN`, es dueño **solo** de las dos funciones
`SECURITY DEFINER`.

Ese tercer rol no es un lujo: con `FORCE ROW LEVEL SECURITY`, una función que
corra como el rol migrador tampoco puede resolver `slug → tenant_id`, porque el
contexto de tenant es justo lo que se está averiguando. Sigue siendo distinto de
darle `BYPASSRLS` a la aplicación — la superficie privilegiada son dos funciones
chicas. `BYPASSRLS` saltea las políticas pero no los `GRANT`, así que el rol
tiene exactamente dos permisos: `SELECT` en `tenants` e `INSERT` en
`platform_audit_log`.

Los roles se crean en `docker/postgres-init/01-roles.sql` — el mismo archivo que
usa el CI — y los permisos sobre tablas viajan en las migraciones.

**Alta de un local.** `npm run create-tenant` crea en una sola transacción el
local, su configuración, la primera sucursal con su caja, los cuatro medios de
pago, los cuatro roles con sus permisos y el Dueño con un link de activación de
un solo uso. Es idempotente por slug: correrlo dos veces no duplica nada ni
invalida el link ya enviado. Del link solo queda el hash SHA-256 en la base.

Los dos topes en pesos se piden en el alta y, si no se cargan, quedan en 0 — lo
que significa que **todo** egreso requiere aprobación. El script lo avisa fuerte,
porque un Dueño que no lo sepa va a pensar que el sistema está roto.

**Errores.** Todo error sale en `application/problem+json` (RFC 9457) con su
código estable, desde `src/shared/errors/`. El frontend decide por `code`,
nunca por `detail`. Dentro de `v1` los códigos no se renombran. Un error
inesperado es `500 internal_error` sin stack ni SQL: el `requestId` es lo que
lleva al log.

**Arquitectura por módulo.** Cada módulo tiene las mismas cuatro capas, y las
dependencias apuntan **siempre hacia adentro**:

```
src/modules/<nombre>/
  api/              # rutas, controladores, DTOs y validación Zod
  application/      # casos de uso; reciben la transacción y los puertos
  domain/           # tipos, reglas puras y los PUERTOS (interfaces)
  infrastructure/   # implementaciones de los puertos, con Prisma Client
  tests/
  <nombre>.module.ts  # construye los casos de uso e inyecta dependencias
  index.ts            # interfaz pública del módulo
```

`api` → `application` → `domain`, e `infrastructure` → `domain`. El centro no
conoce a nadie: los puertos viven en `domain/`, así un caso de uso se puede
probar sin base de datos y Prisma queda confinado a `infrastructure/`.

La inyección es a mano, en `<nombre>.module.ts`, sin contenedor: es el único
archivo del módulo que ve `application/` e `infrastructure/` a la vez.

**ESLint lo hace cumplir, no la disciplina.** Falla el CI si una capa importa
hacia afuera, si un módulo entra a las capas internas de otro, o si el cliente
Prisma se importa fuera de `shared/db`. Está en `eslint.config.js`, y se
verificó que detecta las tres violaciones.

**Prisma Client tipado en los repositorios.** El SQL crudo queda reservado para
donde no hay alternativa, y hoy son tres lugares, cada uno documentado: las dos
llamadas a funciones `SECURITY DEFINER` (Prisma no modela llamadas a funciones)
y el `set_config` de `withTenant()`. Importa porque `updated_at` es `NOT NULL`
sin default en la base: con el cliente tipado lo pone `@updatedAt`, y con SQL
crudo había que escribir `now()` a mano en cada insert.

`pretest` corre `prisma generate`, para que el cliente generado no vuelva a
quedar viejo sin que nadie lo note.

**Permisos.** El catálogo vive en el código
(`src/modules/users/permissions.ts`), no en una tabla: es parte del contrato de
la API. El rol Dueño no guarda sus permisos fila por fila — se calculan — así un
permiso nuevo le llega solo sin migrar datos. La plantilla de roles que
`create_tenant` va a copiar está ahí, con una prueba de que no referencia
permisos inexistentes.

**Monitoreo.** `src/shared/monitoring/` es la única salida hacia Better Stack,
con el SDK compatible con Sentry: cambiar de proveedor es cambiar el DSN. Sin
`MONITORING_DSN` queda inactivo, así que CI y una clonada nueva no necesitan
cuenta. Verificado de punta a punta: el endpoint de ingesta responde 200 y los
errores llegan al panel etiquetados por `tenant_id`. `npm run monitoring:test`
lo reproduce y avisa si falta el DSN.

## Pendientes conocidos

Ninguno bloquea el desarrollo. El paso a paso está en
[`../docs/pendientes-fase-0.md`](../docs/pendientes-fase-0.md).

- **Node 24.** El documento fija Node 24 (LTS activa); la máquina de desarrollo
  tiene 22.19. Prisma 7 pide 20.19 como mínimo y Express 5 pide 18, así que
  todo funciona, y el `Dockerfile` y el CI ya usan Node 24. Es una diferencia
  entre el entorno local y producción: conviene cerrarla con fnm y un
  `.node-version` antes del piloto.
- **`release` en el monitoreo.** Sin ese campo no se pueden agrupar los errores
  por versión desplegada ("este bug apareció en el deploy de ayer"). Es pasarle
  el SHA del commit o la versión del `package.json` a `Sentry.init`. Conviene
  antes del piloto.
- **Integraciones del SDK de monitoreo.** `@sentry/node` v11 instala por defecto
  decenas de integraciones que este proyecto no usa (Google GenAI, Mistral,
  Firebase, ClickHouse). No rompe nada, pero infla el arranque: se recorta
  declarando `integrations` explícitas.
- **dependency-cruiser** para detectar ciclos entre módulos: con los módulos de
  la Fase 0 todavía no aporta. Los límites ya los hace cumplir ESLint.
- **Monitores de Better Stack** (uptime de `/health`, heartbeats de tareas
  programadas, webhook de WhatsApp): necesitan una URL pública, así que son
  Fase 8. El plan gratuito da 10 monitores y 100.000 excepciones por mes, que
  alcanza con margen.
- **Uso comercial del plan gratuito de Better Stack**: su página lo describe
  como para "proyectos personales" y no lo prohíbe explícitamente. Falta
  confirmarlo con su soporte antes de cobrarle a un local.

### Resueltos

- El aviso de `npm audit` por un ReDoS en `effect`: `@prisma/config` lo fija en
  `3.20.0` y la vulnerabilidad afecta a `<=3.22.0`, así que hay un `overrides`
  a `3.22.5` en `package.json` — mismo major, y se verificó que la CLI de Prisma
  y las migraciones siguen funcionando. **No borrar ese override sin revisar
  `npm audit` antes.** Cuando Prisma suba `effect` por su cuenta
  (`npm view @prisma/config dependencies.effect`), se puede quitar.
