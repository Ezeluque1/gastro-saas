# Imagen multi-etapa: el mismo entorno en local y en produccion.
#
# La etapa de build necesita las devDependencies (TypeScript, la CLI de Prisma);
# la imagen final lleva solo las dependencias de produccion, el codigo compilado
# y el cliente Prisma generado.
#
# docs/Backend: "Contenedores" y "Integracion y despliegue continuo".

# Node 24 es la linea LTS que fija el documento.
ARG NODE_VERSION=24-alpine

# -----------------------------------------------------------------------------
# 1. Dependencias completas (incluidas las de desarrollo)
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

# Se copian solo los manifiestos para que esta capa se reuse mientras no
# cambien las dependencias.
COPY package.json package-lock.json ./
RUN npm ci

# -----------------------------------------------------------------------------
# 2. Build: genera el cliente Prisma y compila TypeScript
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# El cliente se genera contra el esquema, sin conectarse a ninguna base.
# prisma.config.ts lee DATABASE_MIGRATION_URL, que en build no existe: se pasa
# un valor de relleno para que la generacion no falle. No se conecta a nada.
ENV DATABASE_MIGRATION_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate

# Que la compilacion para produccion falle aca y no al desplegar: es la
# friccion conocida de ESM + Prisma 7 con las extensiones .js.
RUN npm run build

# -----------------------------------------------------------------------------
# 3. Dependencias de produccion solamente
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# -----------------------------------------------------------------------------
# 4. Imagen final
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

WORKDIR /app

ENV NODE_ENV=production

# dumb-init como PID 1 para que SIGTERM llegue al proceso de Node y el cierre
# ordenado del servidor se ejecute de verdad.
RUN apk add --no-cache dumb-init

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# El esquema y las migraciones van en la imagen para que el paso de migracion
# del despliegue (Fase 8) pueda usarlas. La CLI de Prisma no esta en la imagen
# final a proposito: es una devDependency y la etapa de migracion se arma en la
# Fase 8, cuando se decide el hosting.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

# Usuario sin privilegios. La imagen de Node ya trae el usuario `node`.
USER node

EXPOSE 3000

# El chequeo real de la base lo hace GET /health; el monitor de uptime apunta
# ahi. Esto es solo para que Docker sepa si el contenedor esta sano.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
