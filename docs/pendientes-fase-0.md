# Pendientes de la Fase 0 — paso a paso

La Fase 0 está cerrada y commiteada (`44b43a9`), con cuatro pendientes. Ninguno
bloquea el desarrollo: existen porque dependen de cuentas externas, de la
versión de Node instalada en la máquina o de un repositorio remoto que todavía
no existe.

Conviene cerrarlos **antes de la Fase 1**, para que el multitenancy con RLS se
construya sobre una base verificada de punta a punta: con el CI corriendo en
cada push, con la misma versión de Node que producción y con los errores
llegando al monitoreo.

Cada bloque trae su verificación y, donde hay riesgo, cómo volver atrás.

## Estado comprobado al 2026-11-25

| Pendiente | Hecho |
|---|---|
| Node 24 | Está instalado `OpenJS.NodeJS.22` (22.19.0) por winget, pinneado a la línea 22. Sin fnm, nvm ni volta. `OpenJS.NodeJS.24` disponible (24.22.3) |
| `npm audit` | `@prisma/config@7.10.1` fija `effect` en **exactamente 3.20.0**. La vulnerabilidad es `effect <=3.22.0`; existe **3.22.5**, mismo major |
| CI | Sin remoto, rama `master`, un commit. `gh` CLI no instalado |
| Better Stack | Sin cuenta. El módulo `monitoring` está completo e inactivo sin `MONITORING_DSN`. **Falta el script que fuerza un error de prueba** |

## Orden

**1 → 2 → 3 → 4.** Node cambia el runtime sobre el que corre todo lo demás (y
obliga a reinstalar `node_modules`), el override de dependencias se verifica
sobre ese Node, y el CI conviene estrenarlo con los dos anteriores ya resueltos
para que la primera corrida salga verde. Better Stack es independiente.

Los comandos están en PowerShell, que es la shell primaria de esta máquina.

---

## 1. Node 24 con fnm

El documento del backend fija Node 24 (LTS activa). La máquina tiene 22.19.

Se usa **fnm** y no un cambio global porque en esta máquina hay otros proyectos
activos (`rotios`, `apinoticias`) que siguen en Node 22. Con fnm cada proyecto
usa su versión y no se rompe nada.

```powershell
winget install --id Schniz.fnm --exact
```

Cerrar y reabrir la terminal. Enganchar fnm al perfil de PowerShell, una sola
vez:

```powershell
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'
```

Reabrir la terminal e instalar Node 24:

```powershell
fnm install 24
```

Fijar la versión del proyecto:

- Crear **`Backend/.node-version`** con el contenido `24`. Es lo que hace que
  fnm cambie solo al entrar a la carpeta, y lo que documenta la decisión para
  cualquiera que clone el repo.
- En **`Backend/package.json`**, `engines.node` pasa de `">=22.19.0"` a
  `">=24.0.0"`, que es lo que ya usan el `Dockerfile` y el workflow de CI.
  Queda como advertencia de npm, no como error.

Reinstalar las dependencias sobre el Node nuevo. No alcanza `npm install`: hay
que regenerar lo que se resolvió contra la versión anterior.

```powershell
cd Backend
Remove-Item -Recurse -Force node_modules
npm ci
npx prisma generate
```

**Verificación**

```powershell
node --version        # v24.x
docker compose up -d db
npm run typecheck
npm run lint
npm test              # 57 pruebas
npm run build
```

**Vuelta atrás:** `fnm use 22` vuelve al Node anterior en esa terminal, y el
`OpenJS.NodeJS.22` de winget sigue instalado e intacto. Revertir
`.node-version` y `engines` alcanza para quedar como antes.

---

## 2. El aviso de `npm audit`

`npm audit` reporta un ReDoS de severidad alta en `effect`, dependencia
transitiva de la CLI de Prisma (`prisma` → `@prisma/config` → `effect`).

Dos cosas antes de tocar nada:

- Es una **`devDependency`** y no entra en la imagen de producción: el
  `Dockerfile` instala con `--omit=dev`.
- El "arreglo" que ofrece `npm audit fix --force` es **bajar a Prisma 6**, que
  es el plan B del documento. No se activa por un aviso de una herramienta de
  desarrollo.

La vía limpia: `@prisma/config@7.10.1` fija `effect` en exactamente `3.20.0`,
pero la vulnerabilidad afecta a `<=3.22.0` y existe `3.22.5`. Es el **mismo
major**, así que forzarlo es de bajo riesgo. Ya se verificó que 7.10.1 es la
última estable de Prisma 7 y que sigue pinneando 3.20.0: esperar no sirve.

En **`Backend/package.json`**, agregar:

```json
"overrides": {
  "effect": "3.22.5"
}
```

Dejar anotado en el README por qué está. Sin el motivo, el próximo que lo vea
lo borra.

```powershell
npm install
npm audit
```

**Verificación — esta es la que importa.** El override toca la CLI que corre
las migraciones, así que hay que confirmar que la CLI sigue sana, no solo que
el audit quedó limpio:

```powershell
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test
```

**Vuelta atrás:** quitar el bloque `overrides`, `npm install`, y el aviso queda
documentado como riesgo aceptado hasta que Prisma suba `effect` por su cuenta.
Se revisa cada tanto con:

```powershell
npm view @prisma/config dependencies.effect
```

---

## 3. CI corriendo de verdad

El workflow ya está escrito en `.github/workflows/ci.yml` (en la raíz, con
`working-directory: Backend`). Nunca corrió porque no hay remoto.

**Antes de pushear**, un chequeo que evita un disgusto:

```powershell
git ls-files | Select-String "\.env"
```

Tiene que devolver **solo** `Backend/.env.example` y
`Backend/.env.test.example`. Si aparece `.env` o `.env.test`, parar.

`docs/` incluye precios, estrategia comercial y el análisis de competidores.
**El repositorio va privado.**

1. En github.com, crear un repositorio **privado** y **vacío**: sin README, sin
   `.gitignore`, sin licencia. Si GitHub agrega archivos, el primer push choca.
2. Conectar y pushear. Conviene renombrar la rama a `main`, que es lo que
   espera el ecosistema y lo que el workflow ya acepta (dispara en
   `branches: ['**']`):

```powershell
cd "C:\Peipol\PROYECTOS\SAAS Locales Gastronomicos"
git branch -M main
git remote add origin https://github.com/<usuario>/<repo>.git
git push -u origin main
```

**Verificación**

En la pestaña **Actions** tienen que aparecer y pasar los dos jobs:

- **`check`** — crea los roles con el mismo
  `Backend/docker/postgres-init/01-roles.sql` que usa el entorno local, aplica
  migraciones y corre tipos, linter, formato y las 57 pruebas contra PostgreSQL
  real.
- **`build`** — construye la imagen y levanta un contenedor para confirmar que
  responde `/health`.

**Lo que puede fallar en la primera corrida**, por probabilidad:

- **Finales de línea.** `.gitattributes` fuerza LF, así que `prettier --check`
  debería pasar. Si falla solo en CI, es esto: `git add --renormalize .` y
  commitear.
- **Coherencia de Node.** El workflow ya fija Node 24; si el paso 1 cambió
  `engines`, tiene que quedar alineado.
- **El lockfile.** Si el paso 2 modificó `package-lock.json`, hay que
  commitearlo junto con el `package.json`, o `npm ci` falla.

---

## 4. Better Stack

Es el único punto del entregable de la Fase 0 que quedó **sin verificar**: *"un
error forzado aparece en Better Stack"*.

### 4a. Falta el script que fuerza el error

El plan de la Fase 0 lo mencionaba y no se implementó. Sin él no hay forma de
comprobar el circuito.

- Crear **`Backend/src/scripts/force-error.ts`**: llama a `initMonitoring()`,
  después a `captureError()` con un error de prueba, y termina con
  `await closeMonitoring()`. Ese `await` final **no es opcional**: sin él el
  proceso sale antes de que el SDK alcance a enviar nada, y parece que el
  monitoreo no funciona cuando en realidad sí.
- Usar el `logger` de `src/shared/logger/`, no `console.log`: la regla
  `no-console` de ESLint falla el CI.
- Reusar lo que ya existe en `src/shared/monitoring/index.ts`
  (`initMonitoring`, `captureError`, `closeMonitoring`, `isMonitoringActive`).
  No hace falta tocar ese módulo.
- Agregar el script `monitoring:test` a `Backend/package.json`.

El script tiene que avisar claramente si `MONITORING_DSN` está vacío, en vez de
salir en silencio como si hubiera funcionado.

### 4b. Cuenta y DSN

En Better Stack, plan gratuito: crear la cuenta y obtener un **DSN compatible
con Sentry** para captura de errores. El documento del backend ya decidió
hablarle con `@sentry/node` apuntando a ese DSN, justamente para que cambiar de
proveedor sea cambiar una variable.

Buscar la sección de **error tracking / exceptions** y el DSN que entrega para
el SDK de Sentry. (La navegación exacta del panel no está verificada acá y
estos paneles cambian seguido.)

Cargarlo en `Backend/.env`, que está en `.gitignore`:

```
MONITORING_DSN=https://...
```

**Verificación**

```powershell
cd Backend
npm run monitoring:test
```

El error tiene que aparecer en el panel en menos de un minuto. Confirmar
también que llega **etiquetado** y **sin datos personales**:
`src/shared/monitoring/index.ts` manda `tenant_id`, `route` y `method` como
etiquetas, y el `request_id` como contexto.

### 4c. Dos cosas a verificar con el proveedor

El documento las marca como pendientes. Conviene resolverlas ahora, no cuando
haya un local pagando:

- Que el plan gratuito, que el proveedor describe como *"para proyectos
  personales"*, **permita uso comercial** con clientes que pagan.
- Los **límites vigentes** de monitores, excepciones y retención de logs.

Si el plan gratuito no admite uso comercial, es una decisión de costos para
antes del piloto, no un problema técnico.

### 4d. Lo que queda para la Fase 8

No hace falta ahora, pero conviene saber que falta: el monitor de uptime sobre
`/health`, los heartbeats de las tareas programadas y el monitor del webhook de
WhatsApp. Todo eso necesita una URL pública, que recién existe cuando se decide
el hosting.

---

## 5. Arreglo menor del README

`Backend/README.md` da el comando de migraciones de la base de pruebas en
sintaxis bash (`NODE_ENV=test npm run db:deploy`), que **no funciona en
PowerShell**.

Lo mejor es agregar un script a `Backend/package.json` que funcione igual en
las dos shells y usarlo en el README, en vez de documentar dos variantes.

---

## Verificación final

Con los cuatro cerrados, desde `Backend/`:

```powershell
node --version                 # v24.x
npm audit                      # sin vulnerabilidades
npm run typecheck
npm run lint
npx prettier --check .
npm run build
npm test                       # 57 pruebas
npm run monitoring:test        # el error llega a Better Stack
docker build -t saas-gastro-backend:dev .
```

Y en GitHub: los jobs `check` y `build` en verde sobre `main`.

Al terminar, **actualizar la sección "Pendientes conocidos" de
`Backend/README.md`**: sacar lo resuelto y dejar solo lo que sigue diferido a
propósito — dependency-cruiser para detectar ciclos entre módulos (con los
módulos de la Fase 0 todavía no aporta) y lo de la Fase 8 del punto 4d.

Ese README es lo que va a leer quien arranque la Fase 1: no puede quedar
diciendo que hay pendientes que ya no existen.
