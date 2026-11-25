# Backend — Sistema de gestión gastronómica (SaaS multitenant)

Monolito modular en Node.js, TypeScript, Express 5, PostgreSQL y Prisma 7.

La fuente de verdad es `../docs/`: el documento del MVP (producto), el del
Backend (arquitectura y contrato de la API) y el plan de fases. **Si el código y
los documentos no coinciden, manda el documento** — y hay que actualizar el
documento si algo cambió al implementarlo.

Estado actual: **Fase 0 cerrada** (base del proyecto). Las reglas de negocio
entran desde la Fase 1.

## Arranque

Hace falta Node 22.19 o superior (el documento fija Node 24; ver "Pendientes")
y Docker.

```bash
cp .env.example .env
cp .env.test.example .env.test
docker compose up -d db          # PostgreSQL 18 en el puerto 5434
npm install
npm run db:deploy                # migraciones en la base de desarrollo
NODE_ENV=test npm run db:deploy  # migraciones en la base de pruebas
npm run dev
curl -i http://localhost:3000/health
```

El puerto es 5434 y no el 5432 habitual para no chocar con otros PostgreSQL ya
instalados en la máquina.

## Comandos

| Comando              | Qué hace                                    |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Servidor con recarga (`tsx watch`)          |
| `npm run build`      | Compila a `dist/`                           |
| `npm run typecheck`  | `tsc --noEmit`                              |
| `npm run lint`       | ESLint, incluidas las reglas de modularidad |
| `npm run format`     | Prettier                                    |
| `npm test`           | Vitest contra PostgreSQL real               |
| `npm run coverage`   | Pruebas con cobertura                       |
| `npm run db:migrate` | Crea y aplica una migración (desarrollo)    |
| `npm run db:deploy`  | Aplica las migraciones existentes           |
| `npm run db:reset`   | Borra y recrea la base de desarrollo        |

## Lo que ya está en pie

**Aislamiento.** `withTenant()` (`src/shared/db/with-tenant.ts`) es el único
camino a la base para las consultas de negocio: abre una transacción y fija
`app.tenant_id` con `set_config(..., true)`. El `true` es lo que hace que el
valor viva solo en esa transacción; sin él quedaría pegado a la conexión del
pool y la request siguiente arrancaría con el tenant de otro local.
`tests/integration/with-tenant.test.ts` cubre exactamente eso, y se verificó
que la prueba **falla** si alguien cambia ese argumento.

Las políticas RLS llegan con las tablas de negocio, en la Fase 1. Lo que ya
está garantizado es el mecanismo del que dependen, más que el rol de la
aplicación no es superusuario, no es dueño de las tablas, no tiene `BYPASSRLS`
y no puede alterar el esquema.

**Dos roles de base.** `gastro_migrator` es dueño de las tablas y ejecuta las
migraciones (`DATABASE_MIGRATION_URL`, que usa solo la CLI de Prisma).
`gastro_app` es el rol de la aplicación (`DATABASE_URL`). Los roles se crean en
`docker/postgres-init/01-roles.sql` — el mismo archivo que usa el CI — y sus
permisos viajan en las migraciones.

**Errores.** Todo error sale en `application/problem+json` (RFC 9457) con su
código estable, desde `src/shared/errors/`. El frontend decide por `code`,
nunca por `detail`. Dentro de `v1` los códigos no se renombran. Un error
inesperado es `500 internal_error` sin stack ni SQL: el `requestId` es lo que
lleva al log.

**Límites entre módulos.** ESLint los hace cumplir, no la disciplina: un módulo
solo importa el `index.ts` de otro, y el cliente Prisma no se puede importar
fuera de `shared/db`. Está en `eslint.config.js` y falla el CI.

**Monitoreo.** `src/shared/monitoring/` es la única salida hacia Better Stack.
Sin `MONITORING_DSN` queda inactivo, así que desarrollo y CI no necesitan
cuenta.

## Pendientes conocidos

Ninguno bloquea el desarrollo. El paso a paso para cerrarlos, con verificación
y vuelta atrás de cada uno, está en
[`../docs/pendientes-fase-0.md`](../docs/pendientes-fase-0.md).

- **`MONITORING_DSN` sin cargar.** El módulo está completo pero no se verificó
  contra Better Stack: falta la cuenta. Es cargar la variable, no cambiar
  código.
- **Node 24.** El documento fija Node 24 (LTS activa); la máquina de desarrollo
  tiene 22.19. Prisma 7 pide 20.19 como mínimo y Express 5 pide 18, así que
  todo funciona, y el Dockerfile y el CI ya usan Node 24. Conviene alinear el
  entorno local.
- **`npm audit`** reporta un ReDoS en `effect`, dependencia transitiva de la
  CLI `prisma`. Es una `devDependency` y no entra en la imagen de producción
  (el Dockerfile instala con `--omit=dev`). El "arreglo" que ofrece npm es
  bajar a Prisma 6, que es el plan B del documento y no se activa por esto.
- **dependency-cruiser** para detectar ciclos entre módulos: con los módulos de
  la Fase 0 no aporta todavía.
