# Backend – Sistema de gestión gastronómica (SaaS multitenant)

Nov 21, 2026 · @Ezequiel Luque

Documento técnico del backend. Los flujos y las decisiones de producto están en [MVP – Sistema de gestión gastronómica](https://claude.ai/artifact/2u3kjE4g8nwAbUWUbbCDQ2); acá solo se documenta cómo se construye.

## Stack tecnológico

Node.js, TypeScript, Express, PostgreSQL y Prisma ya están definidos. El resto es una propuesta para discutir. Las versiones de Node.js, Express, Prisma y pg-boss están verificadas al 2026-11-21 (ver Fuentes).

| Capa | Elección | Motivo |
| --- | --- | --- |
| Runtime | Node.js 24 (LTS activa) | Es la línea LTS para producción. Node 26 es la versión Current: se reevalúa cuando pase a LTS |
| Lenguaje | TypeScript en modo estricto (`strict: true`) | Errores de tipos antes de ejecutar, y los esquemas de validación generan los tipos |
| Framework HTTP | Express 5 | Es la versión por defecto en npm desde marzo de 2025, y reenvía a los manejadores de error las promesas rechazadas de handlers `async` |
| Base de datos | PostgreSQL (la versión estable más reciente que ofrezca el proveedor; mínimo 13) | Transacciones, RLS, restricciones `CHECK`, índices parciales y jsonb. El mínimo lo fija pg-boss |
| Acceso a datos | Prisma 7 (Prisma Client y Prisma Migrate) con el adaptador `@prisma/adapter-pg` | Modelo en un esquema declarativo con tipos generados, migraciones versionadas y consultas tipadas. Prisma 7 exige un adaptador de driver. RLS no viene integrado: el tenant se fija con `set_config` dentro de una transacción interactiva (ver "Prisma y el contexto de tenant"). Lo que Prisma no modela (políticas RLS, índices parciales, `CHECK`) va en migraciones SQL a mano |
| Validación | Zod | Un solo esquema valida la entrada y define el tipo TypeScript |
| Autenticación | `argon2` para contraseñas y sesiones en el servidor (token opaco en cookie `httpOnly`) | Hash lento recomendado. Un token opaco guardado como hash permite revocar sesiones al instante. Sin JWT ni token de renovación |
| Tareas en segundo plano | pg-boss (fase 2) | Cola de trabajos sobre PostgreSQL: no agrega Redis ni otra pieza que operar. Requiere Node 22.12 o superior y PostgreSQL 13 o superior |
| Email | Resend | Solo para el Dueño: activación, recuperación y aviso de cambio de clave. Detrás de una interfaz propia |
| Imágenes | Cloudflare R2 (fase 2) | Compatible con S3 y sin cargo por egreso |
| Tiempo real | Server-Sent Events (SSE) | Decidido. Avisa a recepción de pedidos nuevos y cambios de estado, y es más simple que WebSockets |
| Logs | Pino (JSON estructurado) | Cada línea lleva el id de la request y el `tenant_id` |
| Seguridad HTTP | Helmet, CORS restrictivo y `express-rate-limit` | Cabeceras seguras, orígenes permitidos y freno a intentos de login repetidos |
| Configuración | Variables de entorno validadas con Zod al arrancar | La app no inicia si falta una variable |
| Pruebas | Vitest, Supertest y PostgreSQL real en contenedor | Ver la sección de pruebas |
| Calidad | ESLint, Prettier y `tsc` | Se ejecutan en CI en cada cambio |
| Contenedores | Docker (imagen multi-etapa) y Docker Compose para desarrollo | Mismo entorno en local y en producción |
| Hosting | Por definir | Criterios: PostgreSQL administrado con backups automáticos, latencia desde Argentina y costo previsible |

El frontend queda fuera de este documento: consume la API que se define más abajo.

### Compatibilidad entre Express 5 y Prisma 7

Revisado el 2026-11-21. Express y Prisma no dependen uno del otro: Express maneja HTTP, Prisma accede a la base, y se conectan solo a través de nuestros servicios. Lo que condiciona el proyecto son los requisitos de Prisma 7:

| Requisito | Prisma 7 | En este proyecto |
| --- | --- | --- |
| Node.js | Mínimo 20.19.0 (recomendado 22.x) | Node 24. Express 5 pide Node 18 o superior |
| TypeScript | Mínimo 5.4.0 (recomendado 5.9.x) | 5.9.x |
| Módulos | ESM: `"type": "module"` en `package.json`. CommonJS es posible con `moduleFormat = "cjs"` | Proyecto ESM |
| Generador | `prisma-client` con `output` obligatorio | `src/generated/prisma` |
| Conexión | Adaptador de driver obligatorio | `@prisma/adapter-pg` |
| Configuración | `prisma.config.ts` | Una URL para migraciones y otra para la app |

Fricción conocida: en ESM los imports internos llevan extensión `.js`, y se reportan fallos al compilar para producción si el generador o el `tsconfig` no coinciden. Se evita fijando desde el inicio `tsx` para desarrollo, el mismo módulo y generador en `tsconfig` y en el esquema, y una prueba de build en el CI.

**Decisión:** Prisma 7. Si el proyecto base (Express 5 + Prisma 7 + build en Docker) no arranca limpio en una prueba inicial, el plan B es Prisma 6, que ya conocés.

## Arquitectura del backend

El backend es un monolito modular: una sola aplicación y un solo despliegue, dividida internamente en módulos por dominio. Es lo que mejor encaja con un solo desarrollador y con operaciones que cruzan dominios (un pedido toca stock, pagos y caja en una misma transacción). Se descartaron los microservicios porque obligarían a resolver consistencia distribuida sin necesitarlo.

### Capas dentro de cada módulo

| Capa | Responsabilidad | No debe |
| --- | --- | --- |
| Rutas (`*.routes.ts`) | Recibir la request, validar con Zod, exigir el permiso y llamar al servicio | Contener reglas de negocio ni SQL |
| Servicios (`*.service.ts`) | Casos de uso y reglas de negocio (totales, transiciones de estado, stock). Reciben la transacción abierta | Conocer `req` ni `res` de Express |
| Repositorios (`*.repository.ts`) | Consultas con Prisma Client sobre las tablas del módulo, siempre con la transacción recibida (`tx`). SQL crudo parametrizado solo donde hace falta atomicidad (descuento de stock, numeración de pedidos) | Decidir reglas de negocio |

### Módulos

`auth`, `tenants` (tenants, planes, sucursales y configuración), `users` (usuarios, roles y permisos), `catalog`, `stock`, `customers`, `orders`, `delivery`, `cash`, `reports`, `whatsapp` (fase 2) y `audit`.

- **Comunicación entre módulos:** un módulo usa solo la interfaz pública (`index.ts`) de otro, nunca sus tablas ni sus repositorios. Por ejemplo, `orders` llama a `stock` para descontar y a `cash` para registrar el cobro.
- **Una transacción, varios módulos:** la transacción se pasa como parámetro (`tx`) de un servicio a otro, así todo se confirma o se revierte junto.

### Reglas de modularidad

Cada módulo es una pieza con límites claros: se puede entender, probar y modificar sin leer el resto. Esos límites se hacen cumplir con herramientas, no solo con disciplina.

- **Interfaz pública única:** lo que un módulo ofrece a los demás se exporta en su `index.ts`. Nada más es accesible desde afuera.
- **Datos propios:** cada tabla pertenece a un solo módulo. Otro módulo no consulta esa tabla: le pide el dato al dueño. El esquema de Prisma se divide en un archivo por módulo para que la propiedad quede visible (a confirmar al armar el proyecto).
- **Dependencias en un solo sentido:** un módulo solo puede usar a los que están más abajo en la tabla siguiente. No se admiten ciclos.
- **Eventos para lo que no es esencial:** cuando algo pasa, el módulo emite un evento interno después de confirmar la transacción (por ejemplo `order.created`) y otros módulos reaccionan. Así `orders` no depende de `whatsapp` ni de impresión. Lo que debe quedar guardado junto (stock, cobro) no usa eventos: se llama directo dentro de la misma transacción.
- **Cumplimiento automático:** una regla de lint (`no-restricted-imports`) o una herramienta como dependency-cruiser falla el CI si un módulo importa algo que no es la interfaz pública de otro, o si crea un ciclo.
- **Un módulo nuevo no toca a los existentes:** agregar uno (por ejemplo promociones en la fase 2) significa crear su carpeta, su archivo de esquema y sus rutas, y registrarlo en `app.ts`.

| Módulo | Puede usar | Notas |
| --- | --- | --- |
| `tenants`, `audit` | Nada | Base de la plataforma |
| `users` | `tenants` | Roles y permisos |
| `auth` | `users`, `tenants` | Login y sesiones |
| `catalog` | `audit` | Productos, variantes, extras y precios |
| `customers` | Nada | Clientes y direcciones |
| `stock` | `catalog`, `audit` | Descuento y ajustes |
| `cash` | `audit` | Sesiones y movimientos |
| `orders` | `catalog`, `stock`, `customers`, `cash`, `audit` | Es el módulo que coordina la venta |
| `delivery` | `orders`, `cash`, `users`, `audit` | Salidas y rendiciones |
| `whatsapp` (fase 2) | `customers`, `catalog`, `orders` | Entra al sistema por la interfaz pública de `orders` |
| `reports` | Lectura de todos | Única excepción: consultas de solo lectura propias, sin escribir en tablas ajenas |

### Estructura de carpetas

```
src/
  app.ts               # crea la app Express, registra middlewares y módulos
  server.ts            # arranque y cierre ordenado
  config/              # variables de entorno validadas
  shared/
    db/                # cliente Prisma y withTenant()
    http/              # middlewares: sesión, tenant, permisos, errores
    errors/            # AppError y sus subtipos
    events/            # bus de eventos interno
    logger/
  modules/
    orders/
      orders.routes.ts
      orders.schemas.ts      # esquemas Zod
      orders.service.ts
      orders.repository.ts
      orders.state-machine.ts
      orders.events.ts       # eventos que emite el módulo
      index.ts               # interfaz pública del módulo
    catalog/ ...
    stock/ ...
    cash/ ...
  jobs/                # workers de pg-boss (fase 2)
prisma/
  schema/              # un archivo .prisma por módulo
  migrations/          # SQL versionado, incluidas las políticas RLS
prisma.config.ts
tests/
```

### Ciclo de una request

1. Se asigna un id a la request y se registra en el log.
2. El middleware de sesión valida el token y obtiene usuario y tenant.
3. El middleware de tenant abre la transacción y fija `app.tenant_id` con `SET LOCAL`, a través de `withTenant()`.
4. El middleware de permisos verifica `puede(usuario, permiso, sucursal)`.
5. Zod valida cuerpo, parámetros y consulta. Si falla, responde 400.
6. La ruta llama al servicio con la transacción y los datos ya validados.
7. El servicio aplica las reglas y usa los repositorios.
8. Si todo salió bien se confirma la transacción; si hubo un error, se revierte.
9. La respuesta sale en formato JSON uniforme.

Las llamadas a servicios externos (por ejemplo enviar un mensaje de WhatsApp) no se hacen dentro de la transacción: se encolan como trabajo en segundo plano después de confirmar, para no mantener la conexión a la base ocupada esperando a un tercero.

### Prisma y el contexto de tenant

Prisma no aplica RLS por su cuenta. Lo que hace funcionar el aislamiento es que toda consulta de negocio corra dentro de una transacción interactiva donde antes se fijó el tenant. Ese es el único punto de entrada a la base:

```ts
// shared/db/with-tenant.ts
export function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // true = el valor vale solo durante esta transacción
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
```

- **Cliente global oculto:** el cliente `prisma` no se exporta fuera de `shared/db`. Los servicios y repositorios reciben siempre `tx`, y una regla de lint impide importar el cliente directo. Si alguien consultara por fuera, RLS devolvería un error en vez de datos de otro local.
- **Se descartó la extensión que envuelve cada consulta:** existen ejemplos de extensiones de Prisma que abren una transacción por operación, pero chocan con las transacciones explícitas que ya necesitamos (un pedido son varias escrituras juntas) y los ejemplos no están pensados para producción.
- **Transacciones cortas:** la transacción retiene una conexión del pool durante toda la request. Por eso no se llama a servicios externos dentro de ella y se configura un tiempo máximo.
- **SQL crudo con plantillas:** el descuento de stock y `order_counters` usan `$queryRaw` y `$executeRaw` con plantillas etiquetadas, que parametrizan los valores. Nunca se concatena texto.
- **Dos conexiones, dos roles:** la CLI de Prisma (migraciones) toma su URL de `prisma.config.ts` y usa el rol migrador. La aplicación crea el cliente con el adaptador de `pg` y la URL del rol sin privilegios.
- **Pruebas:** las pruebas de aislamiento corren por este mismo camino, contra PostgreSQL real.

### Manejo de errores

- Los errores de negocio son subclases de `AppError` con un código estable: validación (400), no autenticado (401), sin permiso (403), no encontrado (404), conflicto (409, por ejemplo stock insuficiente o número duplicado) y regla de negocio violada (422, por ejemplo una transición de estado no permitida).
- Un único manejador central los convierte en una respuesta de tipo `application/problem+json` (RFC 9457; el formato completo está en la sección API). Cualquier error inesperado responde 500 sin filtrar detalles internos y se registra en el log.
- Con Express 5 no hace falta envolver cada handler `async`: una promesa rechazada llega sola al manejador de errores.

## Multitenancy y aislamiento de datos

El backend es una API en Node.js, TypeScript y Express sobre una única base PostgreSQL compartida por todos los tenants, con aislamiento reforzado por Row Level Security (RLS).

### Multitenancy

- **Una base y un esquema compartido:** todas las tablas de negocio llevan `tenant_id`. Se descartaron el esquema por tenant y la base por tenant: dan más aislamiento, pero complican las migraciones y la operación, y no se justifican con decenas de clientes pequeños.
- **RLS como segunda barrera:** un error en una consulta no puede mezclar datos de dos locales, porque la base misma filtra por tenant.
- **Rol de base sin privilegios:** la aplicación se conecta con un rol que no es superusuario ni dueño de las tablas, y las tablas usan `FORCE ROW LEVEL SECURITY`. Si no, RLS se saltea.

### Cómo se identifica el tenant en cada request

1. Un middleware valida la sesión. El `tenant_id` y el usuario salen de la sesión guardada en el servidor, nunca de un parámetro que envíe el cliente.
2. La request abre una transacción y fija el tenant con `SET LOCAL app.tenant_id`.
3. Las políticas RLS leen ese valor, así que toda consulta de esa transacción queda limitada a su tenant.
4. La sucursal con la que opera el usuario se valida contra sus asignaciones de rol por sucursal en cada operación.

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### Casos sin usuario autenticado

Los mensajes entrantes de WhatsApp llegan por webhook, sin sesión. El tenant se resuelve buscando el ID del número que recibió el mensaje en `whatsapp_accounts`, con una consulta controlada, y recién después se fija el contexto del tenant como en cualquier otra request.

### Login y consultas fuera de RLS

**Decisión: el local se identifica por ruta, sin subdominios en el MVP.** El local se conoce antes de autenticar, así que RLS funciona desde la primera consulta. El usuario solo debe ser único dentro de su local y no se pueden enumerar cuentas entre locales. Así no hace falta wildcard de DNS ni de certificado. Si más adelante se migra a subdominios, la ruta vieja redirige con un 301, y el catálogo público de la fase 2 (otra superficie) puede reconsiderarlos. El formato es `app.<dominio>/l/<slug>`.

1. Se resuelve `slug` → `tenant_id`. Esa consulta es lo único que va fuera de RLS.
2. Con ese dato se abre la transacción con `set_config('app.tenant_id', …, true)` y el resto va con RLS normal. La tabla de usuarios nunca necesita saltarse RLS.
3. Si no existe el local o el usuario, la respuesta de error es la misma, para no revelar qué locales existen.
4. Hay límite de intentos por (local, usuario) y por IP.
5. Después del login, el `tenant_id` sale siempre de la fila de la sesión, nunca de un dato que mande el cliente.

Solo hay tres consultas fuera de RLS: el login (`slug` → tenant), el webhook de WhatsApp (`phone_number_id` → tenant) y el alta de tenants. Se resuelven con funciones `SECURITY DEFINER` mínimas: `resolve_tenant_by_slug`, `resolve_tenant_by_wa_phone` y `create_tenant`. Devuelven solo lo necesario (por lo general un `tenant_id`). Es preferible a darle `BYPASSRLS` al rol de la aplicación, porque con eso cualquier bug saltearía el aislamiento. Cada uso de estas funciones queda registrado en auditoría.

**Reglas del slug y de la sesión por local**

- El slug se valida desde el primer día como un nombre de DNS: minúsculas, números y guiones, hasta 63 caracteres y sin palabras reservadas (`admin`, `api`, `www`). Es inmutable una vez creado.
- El `tenant_id` sale siempre de la sesión. El slug solo se usa en el login y en los enlaces públicos.
- Todos los enlaces se construyen con una función única, y el slug se resuelve en un solo lugar del código.
- La cookie de sesión lleva el path del local, así quien trabaja en dos locales desde el mismo celular no mezcla sesiones.
- Como todos los locales comparten el mismo origen, el contenido que escriben los clientes (por ejemplo las notas de pedido) se escapa siempre al mostrarlo.

### Límites del plan

Al crear una sucursal se compara contra el máximo del plan del tenant (`plans.max_branches`). Es configuración, no código.

## Modelo de datos

El modelo cubre el MVP y deja preparado lo que viene después. Las tablas de la fase 2 están marcadas.

**Convenciones**

- **Claves:** UUID. Todas las tablas de negocio llevan `tenant_id`; solo `plans` y `permissions` no lo llevan.
- **Importes:** `numeric(14,2)`. Fechas: `timestamptz` con `created_at` y `updated_at`.
- **Bajas:** las tablas principales (productos, usuarios, sucursales) se dan de baja con `active` o `deleted_at`, no se borran.
- **Datos congelados:** los pedidos guardan el nombre y el precio de cada ítem y extra al momento de la venta.
- **Búsqueda:** productos, insumos y clientes llevan una columna normalizada `name_search` (minúsculas y sin acentos, calculada al guardar) y los clientes, además, una columna con solo los dígitos del teléfono.

### Plataforma

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `plans` | nombre, precio base, precio por sucursal extra, `max_branches`, features (jsonb) | Sin `tenant_id` |
| `tenants` | nombre, slug, `plan_id`, estado (prueba, activo, suspendido), fin de prueba |  |
| `tenant_settings` | `tenant_id` (único), settings (jsonb) | Moneda, redondeo, monto fijo de envío, tiempos de preparación, alertas de stock, impresión y comportamiento del bot |
| `branches` | tenant, nombre, dirección, teléfono, horarios (jsonb), activa |  |
| `payment_methods` | tenant, nombre, tipo (efectivo, tarjeta, transferencia, billetera), activo |  |

### Usuarios y permisos

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `users` | tenant, nombre, email, hash de contraseña, activo | Los repartidores son usuarios con rol Delivery |
| `permissions` | código, descripción | Catálogo fijo definido en el código, sin `tenant_id` |
| `roles` | tenant, nombre, `is_system` | Los roles iniciales se crean al dar de alta el tenant y son editables |
| `role_permissions` | rol, código de permiso |  |
| `user_branch_roles` | usuario, sucursal (nula = todas), rol | Resuelve el rol por sucursal |
| user\_sessions | usuario, hash del token de sesión, vencimiento, revocación, dispositivo, tipo (usuario o soporte), sesión de soporte (solo en las de tipo soporte, que no tienen usuario) | Permite revocar sesiones |

### Catálogo y precios

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `categories` | tenant, nombre, orden |  |
| `products` | tenant, categoría, nombre, descripción, imagen, tipo (elaborado o comprado), visible en catálogo, activo | No guarda precio |
| `product_variants` | producto, nombre, precio, costo manual (opcional), `track_stock`, código de barras (opcional), orden, activa | Todo producto tiene al menos una. Código de barras único por tenant |
| `extras` | tenant, nombre, precio fijo, activo |  |
| `extra_applicability` | extra, producto o categoría | `CHECK`: exactamente uno de los dos |
| `price_history` | tipo (variante o extra), id, precio anterior y nuevo, usuario, `batch_id` | `batch_id` agrupa un ajuste masivo |
| `promotions`, `promotion_targets` | nombre, tipo, valor, vigencia; destino (producto, variante o categoría) | Fase 2 |

### Stock e insumos

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `supplies` | tenant, nombre, unidad, stock mínimo, costo (opcional), activo |  |
| `supply_barcodes` | insumo, código (texto), presentación, `quantity_per_scan`, activo | Único por tenant. Un insumo puede tener varios códigos |
| `variant_stock` | sucursal, variante, cantidad, mínimo | Clave: sucursal + variante |
| `supply_stock` | sucursal, insumo, cantidad, mínimo | Clave: sucursal + insumo |
| `stock_movements` | sucursal, variante o insumo, tipo (compra, producción, venta, ajuste, merma, devolución), cantidad con signo, motivo, pedido (opcional), usuario | `CHECK`: exactamente uno entre variante e insumo. Es el libro de movimientos |

### Clientes

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `customers` | tenant, teléfono de WhatsApp, nombre, notas | Teléfono único por tenant |
| `customer_addresses` | cliente, dirección, referencia |  |

### Pedidos y delivery

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `orders` | sucursal, número, fecha comercial, canal (mostrador, teléfono, Instagram, WhatsApp, catálogo), tipo (mostrador, retiro, delivery), estado, cliente (opcional), dirección copiada, envío, subtotal, descuento, total, notas, `requires_review`, conversación (opcional), `delivery_run_id`, creado por | Número único por sucursal y fecha comercial |
| `order_items` | pedido, variante (nula = ítem libre), nombre y precio copiados, cantidad, nota, descuento |  |
| `order_item_extras` | ítem, extra, nombre y precio copiados, cantidad | El extra sale como línea propia |
| `order_status_history` | pedido, estado, motivo, usuario, fecha | Motivo obligatorio en Cancelado y No entregado |
| `delivery_runs` | sucursal, repartidor, creado por, fecha | Una salida: varios pedidos asignados de una vez |
| `delivery_attempts` | pedido, número de intento, repartidor, resultado, motivo, fecha | Registra cada reintento |
| `payments` | pedido, medio, monto, estado (pendiente o pagado), efectivo con el que paga el cliente, cobrado por, sesión de caja, `settlement_id`, fecha | El efectivo del delivery queda pendiente hasta la rendición |
| `delivery_settlements` | sucursal, repartidor, sesión de caja, monto esperado, monto recibido, diferencia, registrado por, fecha | Solo registra la diferencia, sin estados |
| order\_counters | sucursal, fecha comercial, último número | Tabla auxiliar para numerar los pedidos |

Estados del pedido: `received`, `preparing`, `ready`, `on_the_way`, `delivered`, `not_delivered`, `cancelled`.

### Caja

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `cash_registers` | sucursal, nombre |  |
| `cash_sessions` | caja, estado, apertura (usuario, fecha, monto, diferencia), cierre (usuario, fecha), efectivo esperado, contado, diferencia, motivo, desglose por medio (jsonb) | Una sola sesión abierta por caja. Inmutable al cerrar |
| `cash_movements` | sesión, tipo (ingreso o egreso), categoría (gasto, retiro, fondo de cambio, proveedor, rendición, ajuste, cobro de pedido), concepto, monto, medio, pago o rendición asociados, comprobante, usuario |  |

### WhatsApp (fase 2)

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `whatsapp_accounts` | tenant, sucursal, ID de cuenta, ID de número, clave de acceso cifrada, estado | ID de número único en toda la plataforma |
| `conversations` | tenant, cliente, cuenta, estado (bot, esperando humano, atendida, cerrada), usuario asignado, último mensaje, fin de la ventana de 24 horas (window\_expires\_at) |  |
| `messages` | conversación, dirección, tipo, contenido, ID del mensaje en WhatsApp, fecha |  |
| `whatsapp_inbox` | tenant, ID de número, tipo (mensaje o estado), clave de deduplicación, payload crudo, estado de procesamiento, fecha de recepción | Fuente de verdad de lo que llega de Meta. Clave única por tenant; las claves y los payloads se conservan al menos 7 días |
| `whatsapp_outbox` | tenant, conversación, tipo (libre o plantilla), categoría (servicio, utilidad o marketing), contenido, estado, reintentos, próximo intento, ID del mensaje en WhatsApp, fecha | Estados: pendiente, enviado, entregado, leído, fallido y bloqueado (ventana cerrada, lo resuelve una persona). La categoría permite mostrar el consumo por local |

### Auditoría

| Tabla | Campos principales | Notas |
| --- | --- | --- |
| `audit_log` | tenant, usuario, entidad, id, acción, antes y después (jsonb), fecha | Cambios de precios, permisos, reaperturas de caja y ediciones de pedidos |

### Tablas y columnas que suman las decisiones de plataforma

| Tabla o columna | Qué agrega | Notas |
| --- | --- | --- |
| `tenants` | `slug` (único, no se cambia), estado (`pilot`, `active`, `past_due`, `suspended`, `cancelled`) | El slug forma parte de la URL de login |
| `tenant_settings` | Zona horaria IANA (por defecto `America/Argentina/Buenos_Aires`), horario de corte del día comercial (por defecto 05:00) |  |
| `orders` | `business_date` (`date`), `version`, `client_request_id` (único por tenant), `loaded_late`, `occurred_at` | `loaded_late` marca los pedidos cargados después de una caída de conexión |
| `cash_sessions` | `business_date` | Fecha comercial de la apertura |
| `order_status_history`, `delivery_attempts` | `client_occurred_at` | Momento del toque en el celular, solo informativo |
| `users` | `must_change_password`, email (opcional salvo Dueño) con verificación, hash y vencimiento de la clave temporal |  |
| `password_reset_codes` | usuario, hash del código, vencimiento, intentos, usado | Solo para Dueños con email verificado |
| `idempotency_keys` | `tenant_id`, clave, endpoint, hash del cuerpo, respuesta, fecha | Única por (tenant, clave). Con RLS. Vence a las 24 o 72 horas |
| `media_assets` | `tenant_id`, `key`, tamaño, tipo MIME, ancho, alto, creado por | `products.image_id` apunta acá. Con RLS |
| `messages` | `wamid` | Único por (tenant, `wamid`) |
| `platform_admins` | Administradores de plataforma, con login propio | Sin `tenant_id` y sin RLS de tenant |
| `platform_audit_log` | Acciones de plataforma y uso de las funciones `SECURITY DEFINER` |  |
| `support_sessions` | Administrador, tenant, motivo, creación, vencimiento, fin, cómo terminó (venció o salió), hash del código de canje y su vencimiento | Una sola activa por administrador. El Dueño lee las de su local; no se pueden editar ni borrar |
| Columna `version` | Pedidos, productos, variantes, insumos, configuración del tenant, usuarios y roles | Control de ediciones simultáneas |
| `tenant_settings` (permisos con tope) | Tope porcentual de descuento del Recepcionista (valor inicial 10%), tope por egreso, tope acumulado de egresos por turno de caja, y si un pago pendiente al entregar solo avisa o bloquea | Los define el Dueño. Ningún monto en pesos tiene valor por defecto: los dos topes en pesos se cargan en el alta del local y, si no se cargan, quedan en 0 |
| `order_status_history` | Origen del cambio (app del repartidor o recepción), motivo e intento. Una reversión se guarda como un registro nuevo, sin sobrescribir el anterior | Para el reporte de entregas marcadas por recepción |
| `orders` (descuento y carga posterior) | Motivo y aprobador del descuento; en la carga posterior, motivo, hora real, hora de carga, usuario y número de comanda en papel (opcional) | Los pedidos cargados después reciben un número nuevo del contador |
| `cash_movements` | Número de remito o factura (opcional) y adjunto en `media_assets` | El reporte marca los egresos sin comprobante |

## Reglas transaccionales

Cada operación de negocio que toca varias tablas se ejecuta en una sola transacción de PostgreSQL: o se guarda todo o no se guarda nada.

### Operaciones y qué se guarda junto

| Operación | Se guarda en la misma transacción |
| --- | --- |
| Crear pedido | `orders`, `order_items`, `order_item_extras`, número del pedido, `stock_movements` y `variant_stock` (variantes con `track_stock`), `payments` y, si se cobra en el local con la caja abierta, `cash_movements` |
| Cambiar estado | `orders.status` y `order_status_history`; en un intento fallido, también `delivery_attempts` |
| Cancelar antes de que salga | Estado, motivo, reversa de stock (movimiento de devolución) y `audit_log` |
| Editar pedido (hasta "En preparación") | Ítems y extras, ajuste de stock, `audit_log` |
| Rendir repartidor | `delivery_settlements`, `payments.settlement_id` de los pedidos incluidos y un `cash_movements` de categoría rendición por el monto recibido |
| Cerrar caja | Cálculo del efectivo esperado, `cash_sessions` en estado cerrado y resumen |
| Ajuste masivo de precios | Variantes y extras afectados y `price_history` con un mismo `batch_id` |
| Alta rápida por código de barras | `supply_barcodes` (y `supplies` si es nuevo) y `stock_movements` |

### Transiciones de estado permitidas

La máquina de estados vive en el código y rechaza cualquier otra transición.

| Desde | Hacia | Quién | Condición |
| --- | --- | --- | --- |
| `received` | `preparing` | Recepción | Al enviar la comanda |
| `preparing` | `ready` | Recepción | Cuando la cocina avisa |
| `ready` | `delivered` | Recepción | Solo mostrador y retiro |
| `ready` | `on_the_way` | Recepción | Solo delivery, al asignar repartidor |
| `on_the_way` | `delivered` | Repartidor (sus pedidos), Recepción o Encargado |  |
| `on_the_way` | `not_delivered` | Repartidor (sus pedidos), Recepción o Encargado | Motivo obligatorio |
| `not_delivered` | `on_the_way` | Recepción | Reintento, queda registrado en `delivery_attempts` |
| `received`, `preparing`, `ready`, `on_the_way` | `cancelled` | Recepción desde `received` y `preparing`; Encargado o Dueño desde `ready` y `on_the_way` | Motivo obligatorio |

Si un pedido no entregado no se logra reutilizar, se registra una merma (`stock_movements` de tipo merma) para que quede reflejada en el stock y en los reportes.

### Entregas, cancelaciones, descuentos, egresos y carga posterior

Los permisos son configurables por tenant: lo que sigue son los valores por defecto y las reglas que aplica el código.

**Entregas**

- **Quién marca:** "Entregado" (con o sin delivery) lo marcan Recepcionista, Encargado y Dueño. El Delivery solo sobre sus pedidos asignados. "No entregado" lo marcan los mismos (con `orders.deliver`), con motivo obligatorio, para que un intento fallido no deje el pedido trabado.
- **Retiro por mostrador:** pasa de Listo a Entregado sin En camino, marcado por recepción. Si el pago sigue pendiente, el sistema avisa pero no bloquea (configurable por tenant).
- **Delivery marcado por recepción:** admite un motivo corto opcional. El efectivo sigue "a rendir" a nombre del repartidor asignado.
- **Auditoría:** se guarda el usuario que lo marcó y si fue desde la app del repartidor o desde recepción.
- **Doble marcado:** si el repartidor y recepción marcan casi a la vez, gana el primero y el segundo recibe OK con el estado actual.

**"No entregado": cuándo, qué se exige y qué pasa después**

- **Cuándo:** solo desde Listo o En camino. Un pedido que todavía se prepara se cancela, con las reglas de siempre (Recepción en Recibido o En preparación, el Encargado después).
- **Qué se exige:** motivo obligatorio con una lista corta (el cliente no retiró, no atendió, dirección incorrecta, otro) y texto libre opcional. Cada cambio queda con usuario, hora y origen (app del repartidor o recepción).
- **Después:** un pedido de delivery no entregado se reintenta al menos una vez y se registra cada intento con su motivo. El pedido no vuelve a En camino por sí solo: un reintento se registra como un nuevo intento sobre el mismo pedido. Si no se logra entregar, se intenta reutilizar el producto y, si no se puede, se marca como pérdida y la merma queda en el stock y los reportes. Si estaba pagado por transferencia, el sistema lo registra y el reembolso lo hace el local por fuera.
- **Pago pendiente:** no afecta a "No entregado". El aviso o bloqueo aplica solo al marcar "Entregado".
- **Corrección de errores:** deshacer un "No entregado" requiere el permiso `orders.revert_undelivered` (por defecto, Dueño y Encargado; el Dueño puede editarlo por rol), con motivo y auditoría con usuario, hora y motivo. Recepción y Delivery no lo tienen: Recepción puede marcar "No entregado" pero no deshacerlo. Un "Entregado" marcado por error lo corrige el Encargado o el Dueño, con motivo y auditoría.

**Cancelaciones**

- El Recepcionista cancela pedidos en Recibido o En preparación, con motivo obligatorio. Cancelar uno en Listo o En camino requiere al Encargado o al Dueño (`orders.cancel_late`), porque ya hay comida hecha o un repartidor en la calle.
- Si estaba cobrado en efectivo, la cancelación deja un movimiento inverso en la caja, visible en el cierre. Si estaba pagado por transferencia, el reembolso se hace fuera del sistema.

**Descuentos**

- El Recepcionista aplica descuentos manuales hasta un tope porcentual por pedido, calculado sobre el total (no por ítem). Valor inicial: 10%, que el Dueño configura en `tenant_settings` y puede bajar hasta 0%. Motivo obligatorio.
- Un descuento por encima del tope lo aprueba el Encargado o el Dueño (`orders.discount_over_limit`), y queda registrado quién aprobó.
- Fase 2: aprobación a distancia desde el celular.

**Egresos de caja**

- **Gastos menores y pagos a proveedores:** los registra el Recepcionista/Cajero con categoría y motivo obligatorios y comprobante opcional, hasta dos topes que define el Dueño: un tope por egreso y un tope acumulado por turno de caja (la suma máxima que Recepción registra por sí sola en un turno, para que no se parta un pago grande en varios chicos). Ambos se cargan en el alta del local: con la inflación cualquier número en pesos queda viejo, así que no hay monto por defecto ni valor escondido en el código. Si no se cargan, el tope queda en 0 y todo egreso requiere la aprobación del Encargado o del Dueño (`cash.movements_over_limit`). En el onboarding se sugiere un monto de arranque (por ejemplo $50.000), marcado como ejemplo y a validar con el local piloto. Por encima de cualquiera de los dos topes, aprueba el Encargado o el Dueño.
- **Retiro del dueño:** solo el Dueño, o el Encargado si el Dueño le da el permiso (`cash.owner_withdrawal`). El Recepcionista no.
- **Comprobante:** para pagos a proveedores hay un campo de número de remito o factura y se puede adjuntar una foto (`media_assets`). Es opcional, pero el reporte marca los egresos que no lo tienen.
- **Sin ediciones:** los egresos no se editan ni se borran. Un error se corrige con un movimiento de ajuste, con motivo y usuario.
- El egreso reduce el efectivo esperado en el cierre, así cualquier diferencia aparece en el arqueo, y el resumen de cierre los muestra por categoría. La reapertura de una caja cerrada sigue siendo solo del Dueño.
- Fase 2: alerta al Dueño cuando se registra un egreso grande.

**Carga posterior**

- **Recepcionista/Cajero** (`orders.backdate`): solo dentro de la sesión de caja abierta y del día comercial en curso. Cubre una caída de internet durante el turno.
- **Encargado y Dueño** (`orders.backdate_any`): sin ese límite. Son los únicos que cargan pedidos de un turno ya cerrado o de un día comercial anterior. Si la hora real cae antes del horario de corte, el pedido es del día comercial anterior y lo carga uno de ellos.
- **Datos obligatorios:** la hora real y un motivo. Sin alguno de los dos, no se guarda.
- **Marca:** cada pedido queda como "cargado después", con el usuario y las dos horas (la real y la de carga). Recibe un número nuevo del contador del día y hay un campo opcional para anotar el número de la comanda en papel.
- **Cobro:** el efectivo entra en la sesión abierta. Un cobro de una sesión ya cerrada lo carga el Encargado o el Dueño.
- El cierre de caja pide haber cargado todo lo pendiente.

**Reportes de control**

- Por usuario: cancelaciones, descuentos, egresos y pedidos cargados después, para detectar quien se aparta de lo normal.
- Entregas marcadas por recepción, que junto con las diferencias de rendición permite detectar abusos.
- Egresos sin comprobante.
- El resumen de cierre de caja ya incluye descuentos, cancelaciones y egresos por categoría.
- Todo queda en la auditoría, con usuario y hora.

### Números de pedido

Una tabla auxiliar `order_counters` (sucursal, fecha comercial, último número) se incrementa dentro de la transacción del pedido con `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. Eso bloquea la fila y evita que dos recepcionistas reciban el mismo número. Una restricción única sobre sucursal, fecha comercial y número actúa como respaldo. Resuelto con un horario de corte configurable (ver "Fecha comercial y zona horaria"): así se calcula la fecha comercial cuando un turno pasa la medianoche.

### Stock y concurrencia

- El stock se descuenta con una sola sentencia atómica (`UPDATE ... SET quantity = quantity - $1`), no leyendo y escribiendo por separado.
- Si el tenant configuró bloquear ante stock insuficiente, la misma sentencia incluye `AND quantity >= $1` y la operación falla si no alcanza.
- Los movimientos de stock nunca se editan: una corrección es un movimiento nuevo.

### Caja

- Un índice único parcial garantiza una sola sesión abierta por caja: `UNIQUE (register_id) WHERE status = 'open'`.
- Una sesión cerrada es inmutable: la base rechaza insertar o modificar sus movimientos. Los errores se corrigen con un movimiento de ajuste en la sesión siguiente, o con una reapertura que solo el Dueño puede hacer y que queda en `audit_log`.

### Fecha comercial y zona horaria

**Fecha comercial.** El día comercial arranca en un horario de corte configurable por tenant (por ejemplo 05:00). Un pedido a las 01:30 del sábado pertenece al viernes. Es simple y no depende de que haya una caja abierta.

- **Numeración:** el contador es por (sucursal, fecha comercial) y se reinicia al pasar el corte, no a medianoche.
- **Sesión de caja:** tiene la fecha comercial del momento de apertura. Una sesión abierta el viernes a las 19:00 y cerrada el sábado a las 02:00 pertenece al viernes.
- **Pedido y cobro:** el pedido toma la fecha comercial de cuando se creó. El cobro entra en la sesión abierta al cobrar. Un pedido de las 23:50 cobrado a las 00:10 sigue siendo del mismo día.
- **Caja olvidada abierta:** pasado el corte, el sistema no la cierra solo, porque falsearía el conteo de efectivo. Avisa al Dueño o al Encargado y al abrir el siguiente turno.
- **Reportes:** se agrupan por fecha comercial, no por rangos de timestamp.
- **Cambiar el corte:** vale desde ese momento en adelante, los pedidos viejos conservan su fecha, y solo se permite con la caja cerrada.

**Zona horaria.**

- Todo se guarda en UTC (`timestamptz`), tanto la creación como cada cambio de estado. Los tiempos de preparación y entrega se calculan sobre UTC.
- Cada tenant tiene un nombre de zona IANA, con valor por defecto `America/Argentina/Buenos_Aires`, y no un desfase fijo como -03:00.
- La fecha comercial se calcula en PostgreSQL con el `now()` de la base, no con el reloj del navegador, porque la PC de un local chico puede estar desfasada. Se guarda como columna `date` (`@db.Date` en Prisma).
- Cuidado con JavaScript: una fecha sin hora como `2026-11-21` se interpreta como medianoche UTC y en hora argentina cae el día anterior. Las conversiones en Node usan Luxon o date-fns-tz, no `new Date()` a mano.
- Tickets y pantallas muestran la hora local del tenant.
- Para ARCA (fase 3): la fecha de emisión de la factura es la fecha calendario, no la comercial. Una venta de las 00:30 del sábado se factura con fecha sábado aunque sea del día comercial del viernes.

### Idempotencia

Un doble toque en "guardar" o un reintento por mala conexión no debe crear ni confirmar dos veces.

- El cliente genera un UUID al abrir el formulario o iniciar la acción (no al tocar el botón) y lo envía en el header `Idempotency-Key`. En un reintento reutiliza la clave; cuando la operación termina bien, genera una nueva.
- El servidor guarda (`tenant_id`, clave, endpoint, hash del cuerpo, respuesta) en `idempotency_keys`, con restricción única, dentro de la misma transacción que la operación. Si el insert choca, devuelve la respuesta guardada, con el mismo número de pedido. Si el hash del cuerpo es distinto, responde 422 (clave reutilizada por error).
- No se usa "buscar y, si no existe, insertar": dos requests simultáneos pasarían ambos. Lo resuelve la restricción única.
- Si el primer request sigue en curso, el segundo recibe 409 con un reintento corto.
- La tabla es por tenant, tiene RLS y las claves vencen a las 24 o 72 horas.

| Operación | Protección |
| --- | --- |
| Crear pedido (recepción, catálogo) | Clave de idempotencia y, además, `client_request_id` único por (tenant, valor) en el propio pedido, que dura para siempre |
| Registrar un cobro, un movimiento de caja o una rendición | Clave. Es lo más importante: un duplicado suma efectivo dos veces |
| Ajuste manual de stock, compra de insumos | Clave. Los movimientos de stock de un pedido ya quedan cubiertos por la clave del pedido |
| Cambio de estado (incluido el del repartidor) | Idempotente por naturaleza (ver abajo) |
| Webhook de WhatsApp | Se deduplica por el ID del mensaje de Meta (`wamid`), único por (tenant, `wamid`) |
| Pedido creado por el bot | Clave determinística, por ejemplo hash de (conversación, versión del resumen confirmado), para que un doble "sí" no cree dos pedidos |
| Ajuste masivo de precios | Clave. Un reintento duplicado aplicaría el porcentaje dos veces |

**Cambios de estado.** La transición es condicional: `UPDATE ... WHERE id = ? AND estado = 'En camino'`. Si el pedido ya está en Entregado, devuelve OK con el estado actual y no un error, lo pida quien lo pida: si el repartidor y recepción lo marcan casi a la vez, gana el primero. Cualquier otra transición inválida devuelve 409 con el estado real.

**Celular del repartidor.** El botón pasa a "enviando" y la acción queda en cola con su clave hasta que el servidor responde; si se corta la conexión, reintenta sola sin duplicar. El momento del toque se guarda como dato informativo (`occurred_at` del cliente), pero los tiempos reales se calculan con la hora del servidor. Una cola offline completa, que sobreviva a cerrar la app, queda para la fase 2.

### Edición simultánea (versión)

- El pedido tiene una columna `version` que parte en 1. Cada edición (incluidos ítems, extras y notas) la sube en uno. Las ediciones de ítems cambian el pedido como un todo y no tienen versión propia.
- El cliente guarda la versión que cargó y la manda al guardar. El servidor ejecuta `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?` dentro de la transacción. Si no afecta ninguna fila, responde 409 con el estado actual del pedido.
- En Prisma se usa `updateMany({ where: { id, version }, data: { ..., version: { increment: 1 } } })` y se revisa el `count`. El `update` común no sirve porque no da el recuento y falla distinto.
- En la misma transacción van el recálculo de stock y totales y la auditoría, así un conflicto no deja el stock a medias.
- El recepcionista que pierde la carrera ve un mensaje claro ("Este pedido lo modificó otra persona hace un momento") con el pedido recargado. En el MVP los cambios no se fusionan: revisa y vuelve a guardar.
- **Orden de chequeos:** primero la idempotencia (un reintento con la misma clave devuelve la respuesta guardada y no un 409, aunque la versión ya haya subido). Los cambios de estado también suben la versión, y el chequeo de que el estado todavía permite editar va en la misma transacción.

| Con versión | Sin versión |
| --- | --- |
| Pedidos, productos y variantes, insumos, configuración del tenant, usuarios y roles | Movimientos de stock, pagos, movimientos de caja y auditoría (son de solo agregar). La sesión de caja cierra con transición condicional: solo una abierta por caja |

## Autenticación y permisos

Todos los usuarios, repartidores incluidos, entran con usuario y contraseña. Lo que cada uno puede hacer depende de su rol en cada sucursal.

### Autenticación

- **Contraseñas:** se guardan con un hash lento (argon2id) y nunca en claro.
- **Sesión en el servidor, sin JWT ni token de renovación.** Un token opaco, guardado como hash en `user_sessions` (usuario, hash, vencimiento, revocación, dispositivo) y validado en cada request, con una caché corta. Revocar es inmediato: al restablecer o cambiar una clave, al dar de baja a un empleado y al suspender un local. La duración es configurable por rol, para que el repartidor mantenga la sesión larga en el celular. Si en el futuro hay varios servicios, se puede sumar JWT.
- **Cookie:** el token viaja en una cookie `httpOnly` con el path del local, para no mezclar sesiones entre locales. También autentica el stream de eventos en vivo. El `tenant_id` sale de la fila de la sesión y no del cliente, y los permisos se consultan en cada request, así un cambio de rol se aplica de inmediato. Como la sesión va en cookie, las acciones que modifican datos necesitan protección CSRF (`SameSite` y verificación del origen): consecuencia de esta decisión, definida en la sección API.
- **Protección del login:** límite de intentos y bloqueo temporal tras varios fallos.

### Autorización

Cada endpoint declara el permiso que exige. La verificación es `puede(usuario, permiso, sucursal)`:

1. Busca las asignaciones del usuario en `user_branch_roles` que cubran esa sucursal (la asignada o "todas").
2. Junta los permisos de esos roles en `role_permissions`.
3. Autoriza solo si el permiso está en ese conjunto.

El repartidor tiene una restricción adicional: solo puede ver y actuar sobre los pedidos de sus propias salidas (`delivery_runs.courier_id`).

### Catálogo inicial de permisos

Los permisos viven en el código. Los roles iniciales traen un conjunto por defecto que el Dueño puede editar. Los conjuntos por defecto de cada rol están más abajo.

| Permiso | Qué permite |
| --- | --- |
| `orders.create`, `orders.edit` | Tomar y editar pedidos |
| `orders.change_status` | Cambiar estados desde recepción |
| `orders.cancel` | Cancelar con motivo un pedido en Recibido o En preparación |
| `orders.discount` | Aplicar descuentos manuales hasta el tope que define el tenant |
| `orders.deliver` | Marcar "Entregado" o "No entregado": Recepcionista, Encargado, Dueño y Delivery (este último solo en sus pedidos). "No entregado" solo desde Listo o En camino. Deshacer un "No entregado" requiere `orders.revert_undelivered`; Recepción puede marcarlo pero no deshacerlo. |
| orders.revert\_undelivered | Revertir un pedido marcado como No entregado, con motivo |
| `catalog.manage` | Productos, variantes, extras y categorías |
| `prices.edit` | Ajustes de precio individuales, por categoría y generales |
| `stock.view`, `stock.adjust` | Ver y ajustar stock |
| `supplies.create` | Alta rápida de insumos y códigos de barras |
| `cash.open`, `cash.close`, `cash.reopen` | Apertura, cierre y reapertura de caja |
| `cash.movements` | Ingresos y egresos manuales (gastos y pagos a proveedores, hasta el tope por egreso) |
| `settlements.create` | Rendir repartidores |
| `reports.view` | Ver reportes |
| `users.manage`, `roles.manage` | Usuarios, roles y permisos |
| `settings.manage` | Configuración del tenant |
| `whatsapp.inbox` | Atender la bandeja de WhatsApp (fase 2) |
| `orders.view` | Ver pedidos (el repartidor solo los de sus salidas) |
| `orders.print` | Imprimir y reimprimir comandas, tickets y precuentas |
| `orders.backdate` | Cargar después un pedido con la hora en que ocurrió (caída de conexión) |
| `delivery.assign` | Armar salidas y asignar repartidor |
| `users.reset_password` | Restablecer la clave de usuarios de rol inferior |
| `data.export` | Exportar los datos del local |
| `audit.view` | Consultar el registro de auditoría |
| `orders.cancel_late` | Cancelar un pedido en Listo o En camino |
| `orders.discount_over_limit` | Aprobar descuentos por encima del tope |
| `orders.backdate_any` | Cargar pedidos de un turno cerrado o de un día comercial anterior (orders.backdate cubre solo el turno abierto) |
| `cash.movements_over_limit` | Registrar egresos por encima del tope |
| `cash.owner_withdrawal` | Registrar el retiro del dueño |

### Permisos por defecto de cada rol

Es la plantilla que `create_tenant` copia a cada local nuevo. Después el Dueño puede editar los roles. ✔ = lo tiene.

| Permiso | Dueño | Encargado | Recepcionista / Cajero | Delivery |
| --- | --- | --- | --- | --- |
| `orders.view` | ✔ | ✔ | ✔ | Solo sus salidas |
| `orders.create`, `orders.edit` | ✔ | ✔ | ✔ | — |
| `orders.change_status` | ✔ | ✔ | ✔ | — |
| `orders.print` | ✔ | ✔ | ✔ | — |
| `orders.deliver` | ✔ | ✔ | ✔ | ✔ (sus pedidos) |
| orders.revert\_undelivered | ✔ | ✔ | — | — |
| `orders.cancel` (Recibido, En preparación) | ✔ | ✔ | ✔ | — |
| `orders.cancel_late` (Listo, En camino) | ✔ | ✔ | — | — |
| `orders.discount` (hasta el tope) | ✔ | ✔ | ✔ | — |
| `orders.discount_over_limit` | ✔ | ✔ | — | — |
| `orders.backdate` (turno abierto) | ✔ | ✔ | ✔ | — |
| `orders.backdate_any` | ✔ | ✔ | — | — |
| `delivery.assign` | ✔ | ✔ | ✔ | — |
| `settlements.create` | ✔ | ✔ | ✔ | — |
| `whatsapp.inbox` | ✔ | ✔ | ✔ | — |
| `cash.open`, `cash.close` | ✔ | ✔ | ✔ | — |
| `cash.movements` (hasta el tope) | ✔ | ✔ | ✔ | — |
| `cash.movements_over_limit` | ✔ | ✔ | — | — |
| `cash.owner_withdrawal` | ✔ | Si el Dueño se lo da | — | — |
| `cash.reopen` | ✔ | — | — | — |
| `stock.view` | ✔ | ✔ | ✔ | — |
| `stock.adjust`, `supplies.create` | ✔ | ✔ | — | — |
| `catalog.manage` | ✔ | ✔ | — | — |
| `prices.edit` | ✔ | — | — | — |
| `reports.view` | ✔ | ✔ (su sucursal) | — | — |
| `audit.view` | ✔ | ✔ (su sucursal) | — | — |
| `users.reset_password` | ✔ | ✔ (Recepcionista y Delivery) | — | — |
| `users.manage`, `roles.manage`, `settings.manage`, `data.export` | ✔ | — | — | — |

Cocina no tiene rol en el MVP. En la fase 2 se suma un permiso para la pantalla de cocina.

**Reglas que acompañan a la tabla**

- **Dueño:** es un rol de sistema con todos los permisos, calculado en el código y no guardado fila por fila, así un permiso nuevo le llega solo. No se puede editar, ni dar de baja al último Dueño activo. Se recomienda tener dos por local.
- **Alcance:** los permisos que afectan a todo el local (`prices.edit`, `users.manage`, `roles.manage`, `settings.manage`, `data.export`) solo valen con un rol asignado en todas las sucursales, porque el precio y la configuración son únicos. El resto se evalúa por sucursal.
- **Sin escalada:** nadie puede otorgar permisos que no tiene. Crear usuarios y editar roles es solo del Dueño.
- **Delivery:** ve únicamente sus salidas y, de cada pedido, nombre, dirección, teléfono, notas, monto y medio de pago. No ve caja, stock ni pedidos de otros repartidores.
- **Acciones siempre auditadas:** cancelar, descontar, ajustar stock, cargar un pedido después, cambiar precios, reabrir caja, restablecer una clave y exportar datos.
- **Plantilla versionada:** cambiar la plantilla no modifica los roles de locales ya creados. Cuando se agrega un permiso al catálogo, una migración lo suma a los roles que correspondan.
- **Pruebas:** la tabla es la base de una prueba por endpoint que verifica qué rol entra y cuál recibe 403.

### Datos sensibles

La clave de acceso de WhatsApp de cada tenant se guarda cifrada, con la clave de cifrado fuera de la base (variable de entorno o gestor de secretos). Las contraseñas y los tokens nunca se escriben en los logs.

### Recuperación de contraseña y cierre de sesiones

**Quién restablece a quién.**

- El Dueño restablece a Recepcionista, Encargado y Delivery desde su panel. El Encargado puede hacerlo sobre Recepcionista y Delivery con el permiso users.reset\_password, que viene activado por defecto y el Dueño puede quitar por tenant.
- Nadie restablece a un usuario de rol igual o superior, salvo un Dueño sobre otro Dueño.
- Todo queda en la auditoría: quién, a quién y cuándo.

**Clave temporal (usuarios sin email).** El sistema genera una clave aleatoria, sin caracteres ambiguos, y la muestra una sola vez en pantalla. Se guarda solo el hash y vence a las 24 o 72 horas. En el primer ingreso se obliga a elegir una clave propia.

Si alguien usara la clave temporal antes que el empleado, tendría que fijar una clave nueva y el empleado después no podría entrar: esa diferencia se nota enseguida.

**El Dueño se recupera solo, por email.**

- Pide el local y el email, y la respuesta es siempre la misma, exista o no la cuenta.
- Recibe un código de 6 dígitos, de un solo uso, que vence a los 10 minutos, con máximo 5 intentos y límite de pedidos por hora.
- Su email se verifica en el alta, con el mismo link de activación.
- Cualquier usuario con rol Dueño y email verificado puede hacerlo, por eso conviene tener dos Dueños por local.
- Respaldo: si perdió el acceso a su email y no hay otro Dueño, lo resuelve el administrador de plataforma, después de confirmar su identidad por el contacto registrado en el alta.

**Seguridad.**

- Al cambiar o restablecer una clave se revocan todas las sesiones del usuario. Importa por las sesiones largas del repartidor.
- Se avisa por email al Dueño cuando se cambia su contraseña. Cambiar el email del Dueño pide la contraseña actual y verificar la dirección nueva.
- Cambiar la propia clave estando logueado pide la contraseña actual, para cualquier rol.
- Mínimo 8 caracteres, se rechazan las más comunes y se guardan con argon2id.
- Una baja de empleado es una desactivación y no un borrado, y cierra sus sesiones.

## Plataforma: alta de locales y estado del tenant

### Alta de locales

**Decisión:** en el MVP el alta la hace el administrador de plataforma con un script o CLI. Con 1 a 5 locales durante el piloto es barato, seguro y coincide con el onboarding acompañado.

- **Administrador de plataforma:** vive en una tabla aparte (`platform_admins`), no es un rol dentro de un tenant ni un "tenant súper-usuario", que es la mezcla que suele romper el aislamiento. No tiene RLS de tenant, tiene login propio (por ejemplo `admin.<dominio>`), idealmente con 2FA, y cada acción queda en `platform_audit_log`.
- **`create_tenant`** corre en una sola transacción, es idempotente y falla entera si algo sale mal. Crea:
  1. El tenant con nombre y `slug`. El slug se valida (palabras reservadas como `admin`, `api`, `www`) y no se cambia después.
  2. La primera sucursal y su caja.
  3. Los roles base copiados desde una plantilla: Dueño, Encargado, Recepcionista/Cajero y Delivery, con sus permisos. Cocina queda fuera porque no usa el sistema.
  4. El primer Dueño, con un link de activación de un solo uso y con vencimiento, mejor que una contraseña temporal: así el administrador nunca conoce su clave.
  5. La configuración por defecto: moneda, medios de pago, envío fijo, horarios, zona horaria y horario de corte.
  6. El plan: plan base, máximo de sucursales (por ahora 5) y estado inicial.
  7. Los dos topes en pesos del Recepcionista (por egreso y acumulado por turno de caja), que se piden en este paso y no tienen valor por defecto: si no se cargan, quedan en 0 y todo egreso requiere aprobación. El tope de descuento arranca en 10%.
- **Catálogo inicial:** script de importación desde planilla, o carga junto con el Dueño en su propia cuenta.
- **Soporte:** si hace falta entrar a un local, se usa el modo soporte: solo lectura, temporal (30 minutos), con motivo obligatorio y auditado, visible para el Dueño. Solo puede usar una lista explícita de rutas `GET` de lectura (las exportaciones quedan prohibidas y responden 403 `support_mode_forbidden`), y tiene su propia cookie. Nunca se usa la contraseña del usuario ni hay acceso permanente a ningún local. Las reglas completas están en la sección API (Modo soporte).

### Estados del tenant

Un local en pleno turno no puede quedar trabado.

| Estado | Efecto |
| --- | --- |
| Piloto / activo | Todo funciona |
| En mora (gracia de 7 a 10 días) | Todo funciona, con un aviso al Dueño |
| Suspendido | Solo entran el Dueño y el Encargado, en solo lectura (reportes, historial, exportar datos). No se crean pedidos nuevos y los demás roles ven "contactá al administrador" |
| Cancelado | Sin acceso. Los datos se conservan 30 a 90 días, el Dueño puede exportarlos y después se borran o anonimizan |

- **Cierre de turno:** la suspensión no impide cerrar la caja abierta ni registrar la rendición de repartidores. Una sesión abierta se puede terminar.
- **Bot de WhatsApp:** el webhook siempre responde 200 a Meta (si no, Meta reintenta y puede deshabilitarlo). Guarda el mensaje, no crea pedidos y no genera alertas en recepción. Responde con un mensaje fijo, una sola vez por conversación cada 24 horas: el mismo texto que ya manda cuando el local está cerrado, sin revelar el motivo. Con el local en mora funciona con normalidad; con el local cancelado no responde y se recomienda desconectar su número. Según lo indicado, Meta da 1.000 mensajes de servicio gratis al mes por número y cobra desde el 1.001: confirmar la tarifa vigente antes de fijar el precio del SaaS.
- **Sesiones:** como cada request valida la sesión en la base, suspender el local revoca al instante las sesiones de los roles que pierden el acceso. El Dueño y el Encargado conservan la suya, en solo lectura.
- **Quién lo cambia:** en el MVP, el administrador a mano desde el script o el panel. No hay cobro automático todavía, así que no hace falta un proceso que suspenda por fecha.

## API

Las convenciones comunes de la API (versionado, formato de respuestas, errores, paginación y CSRF) están definidas en las subsecciones de abajo. Los endpoints de cada módulo están en “Endpoints por módulo”, más abajo, y son el contrato de la v1 (el cuerpo de cada pedido se define al implementar). Estos son los módulos de la API:

- Autenticación y sesiones.
- Tenant, plan, sucursales y configuración.
- Usuarios, roles y permisos.
- Catálogo: categorías, productos, variantes, extras y precios.
- Stock: productos, insumos, códigos de barras y movimientos.
- Clientes y direcciones.
- Pedidos: alta, edición, estados y cancelación.
- Delivery: salidas, intentos de entrega y rendiciones.
- Caja: sesiones y movimientos.
- Reportes.
- WhatsApp (fase 2): webhook entrante, bandeja y envío de mensajes.

### Convenciones y versionado

La API es REST sobre JSON y vive bajo el path del local: `https://app.<dominio>/l/{slug}/api/v1`. Es consecuencia de la cookie con el path del local, que solo se envía a las rutas de ese local. Si el slug de la URL no coincide con el de la sesión, responde 403 con el código tenant\_mismatch. El panel de plataforma va en su propio host, `https://admin.<dominio>/api/v1`, con su propia cookie (Path=/) y su propia tabla de sesiones, sin compartir nada con las de los locales.

- **Versionado en la URL.** Se pasa a `/v2` solo ante un cambio que rompe: quitar o renombrar un campo, cambiar su tipo o significado, pedir un campo nuevo como obligatorio o cambiar un código de error. Agregar endpoints, parámetros opcionales o campos en las respuestas no rompe, y el frontend ignora lo que no conoce.
- **Compatibilidad entre despliegues.** El único cliente del MVP es el frontend propio. Aun así `v1` se mantiene compatible hacia atrás, para que una pestaña abierta con el frontend anterior siga funcionando después de un despliegue. Una `v2` convivirá con `v1` solo hasta migrar el frontend.
- **Fuera del versionado:** el webhook de WhatsApp (`/webhooks/whatsapp`, con la forma que define el proveedor) y `/health`.
- **JSON en UTF-8**, campos en camelCase (en la base son snake\_case y los mapea la capa de repositorios), ids UUID, recursos en plural y en inglés, como los módulos y las tablas.
- **Importes** como string decimal con dos decimales (`"1250.50"`): es lo que produce la serialización del `Decimal` de Prisma y evita errores de punto flotante en el navegador. En la base el tipo es numeric(14,2). El servidor es la única fuente de los totales: el redondeo se define una sola vez en el backend (mitad hacia arriba a dos decimales por línea, más el redondeo del local al total) y los reportes se suman en SQL. El frontend nunca usa number con decimales: para la vista previa del carrito convierte a centavos enteros, suma y muestra, y el total definitivo lo devuelve el servidor.
- **Fechas y horas** en ISO 8601 y UTC (`2026-11-24T19:55:00Z`). La fecha comercial va como `YYYY-MM-DD` y se interpreta en la zona horaria del local.
- **Métodos.** `GET` nunca modifica datos. `POST` crea o ejecuta una acción. `PATCH` modifica parcialmente e incluye `version`. `DELETE` da de baja (desactiva) y no borra. Las acciones que no son CRUD son `POST /recurso/{id}/acción`, por ejemplo `/orders/{id}/cancel`.
- **Cabeceras.** `Idempotency-Key` en las creaciones y acciones que lo exigen (ver Idempotencia). `X-Request-Id` en toda respuesta: lo genera el servidor, es el mismo que se escribe en el log y se devuelve dentro de los errores.

### Formato de errores

Todos los errores responden `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)) con los miembros estándar `type`, `title`, `status` y `detail`, más tres propios: `code`, `requestId` y, en validación, `errors`. Reemplaza la forma `{ code, message, details }` que se había pensado al diseñar el manejador central.

```json
{
  "type": "/errors/validation_error",
  "title": "Datos inválidos",
  "status": 400,
  "detail": "Revisá los campos marcados.",
  "code": "validation_error",
  "requestId": "b7e1c0f2-5d1a-4c1e-9d3e-0f6a2b7c9a10",
  "errors": [
    { "pointer": "/items/0/quantity", "code": "too_small", "detail": "Debe ser mayor a 0" }
  ]
}
```

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `validation_error` | 400 | Cuerpo, ruta o consulta inválidos, incluidos los parámetros que la API no conoce. Trae `errors`. |
| `unauthenticated` | 401 | Sin sesión, sesión vencida o revocada. El frontend vuelve al login del local. |
| `invalid_credentials` | 401 | Login fallido. Es el mismo error si el local no existe, el usuario no existe o la clave es incorrecta. |
| `permission_denied` | 403 | Falta un permiso, o el local de la sesión no coincide con el slug de la ruta (código tenant\_mismatch). Trae `permission` (por ejemplo `orders.discount_over_limit`) y, si aplica, el tope vigente. |
| `tenant_suspended` | 403 | Local suspendido: Dueño y Encargado pueden leer pero no escribir. |
| `csrf_rejected` | 403 | Escritura que no pasa la verificación de origen (ver Protección CSRF). |
| support\_mode\_forbidden | 403 | Ruta fuera de la lista de lectura permitida en modo soporte, incluidas las exportaciones. |
| support\_session\_active | 409 | El administrador ya tiene una sesión de soporte abierta. |
| support\_code\_invalid | 422 | El código de canje no existe, ya se usó o venció. Es el mismo error en los tres casos para no dar pistas. |
| `not_found` | 404 | No existe, o es de otro local (con RLS no se distingue). |
| `version_conflict` | 409 | La `version` enviada no es la actual. Trae `currentVersion`. |
| `insufficient_stock`, `already_exists` | 409 | Stock insuficiente, o número o clave única duplicados. |
| `idempotency_in_progress` | 409 | Misma `Idempotency-Key` cuya primera ejecución sigue en curso. |
| `idempotency_key_reuse` | 422 | Misma `Idempotency-Key` con un cuerpo distinto. |
| `invalid_transition` | 422 | Cambio de estado no permitido. Trae `from` y `to`. |
| Otras reglas de negocio | 422 | Por ejemplo `cash_session_closed` o `backdate_outside_shift`. Cada módulo define las suyas. |
| `payload_too_large`, `unsupported_media_type` | 413, 415 | Cuerpo sobre el límite, o sin `Content-Type: application/json`. |
| `rate_limited` | 429 | Demasiados intentos o pedidos. Trae la cabecera `Retry-After`. |
| `internal_error` | 500 | Error inesperado. Sin detalles internos: el `requestId` lleva al log. |
| `service_unavailable` | 503 | Base de datos caída o mantenimiento. |

Esta tabla es el contrato de la v1: dentro de v1 los códigos no se renombran. Los descuentos o egresos que superan el tope no llevan código nuevo: responden `permission_denied` con el permiso (`orders.discount_over_limit` o `cash.movements_over_limit`) y el tope vigente. Las reglas de negocio de cada módulo (422) se definen al implementarlo, en snake\_case, y se suman a esta lista central (por ejemplo `whatsapp_window_closed`).

- **`code` es el identificador estable.** El frontend decide por `code` y nunca por `detail`, que es un texto en español para mostrar o registrar. `type` repite el código como URI relativa y no hace falta publicar una página por error.
- **Dentro de `v1` los códigos no se renombran.** Agregar uno nuevo no rompe; el frontend trata cualquier código desconocido según su estado HTTP.
- **Validación.** Se informan todos los campos inválidos juntos. Cada ítem de `errors` lleva `pointer` (JSON Pointer al campo del cuerpo) o `parameter` (nombre en la consulta), más `code` y `detail`.
- **Qué no se filtra.** Los 5xx devuelven un `detail` genérico, sin stack ni SQL. Los 4xx se registran sin el cuerpo del pedido, para que las claves no lleguen al log.
- **401 y 403 se tratan distinto.** Un 401 manda al login. Un 403 muestra el mensaje en pantalla y deja la sesión abierta.

### Paginación y filtros

Las listas que crecen sin parar (pedidos, clientes, movimientos de caja y de stock, rendiciones, auditoría) se paginan por cursor y no por número de página. Con `OFFSET`, un pedido nuevo que entra mientras se pagina corre las filas y repite o saltea resultados, y el costo crece con la profundidad. Toda lista responde `{ "data": [...] }`, así que sumarle `page` después no rompe nada.

```json
{
  "data": [ { "id": "...", "number": 42, "status": "received" } ],
  "page": { "limit": 25, "nextCursor": "eyJ0IjoiMjAyNi0xMS0yNFQxOTo1NTowMFoiLCJpZCI6Ii4uLiJ9", "hasMore": true }
}
```

- **Parámetros:** `limit` (25 por defecto, máximo 100) y `cursor`, un valor opaco que devuelve la respuesta anterior. En la última página `nextCursor` es `null`.
- **Orden fijo por endpoint**, con `id` como desempate, y un índice que empieza por `tenant_id` seguido de la columna de orden. Un `sort` opcional acepta solo columnas de una lista permitida (por ejemplo `-createdAt`). Un cursor emitido con otro orden se rechaza con `validation_error`.
- **Sin `total` por defecto.** Contar filas en tablas grandes cuesta. Los reportes calculan sus totales aparte y no se paginan: exigen un rango de fechas.
- **Listas acotadas** (categorías, productos, extras, sucursales, usuarios, roles) se devuelven completas y sin `page`. Un local chico tiene decenas o pocos cientos de productos. Si alguna crece, pasa a cursor con el mismo formato.
- **Listado resumido, detalle completo.** El listado de pedidos trae los campos para mostrar una fila; el ítem con sus líneas, extras y pagos viene en el detalle.

**Filtros**

- **Igualdad por defecto**, con los nombres del recurso en camelCase: `status`, `type`, `branchId`, `customerId`, `paymentStatus`. Varios valores van separados por coma (`status=received,preparing`) y significan “cualquiera de”.
- **Fechas.** Las listas operativas (pedidos, caja, rendiciones) filtran por fecha comercial con `businessDateFrom` y `businessDateTo`, ambas inclusivas y en formato `YYYY-MM-DD`. Si no se manda rango, la lista de pedidos devuelve la fecha comercial actual. La auditoría filtra por instante con `createdFrom` (inclusivo) y `createdTo` (exclusivo), en ISO 8601 UTC.
- **Búsqueda de texto** con `q`, de 2 caracteres como mínimo, que busca “contiene” sin distinguir mayúsculas ni acentos. Se limita a clientes (nombre y teléfono), productos (nombre y código de barras) e insumos. No depende de extensiones de PostgreSQL, porque no todos los hostings las ofrecen: compara con `ILIKE` contra una columna normalizada `name_search` (minúsculas y sin acentos, calculada al guardar), siempre filtrando por tenant. En clientes también busca en una columna con solo los dígitos del teléfono. Si con muchos datos se vuelve lenta, se activa `pg_trgm` con un índice GIN, después de verificar con `CREATE EXTENSION` que el hosting elegido lo permite.
- **Parámetros desconocidos dan 400.** Un `staus=received` con un error de tipeo no puede devolver todos los pedidos sin avisar.
- **Los permisos mandan sobre los filtros.** El Encargado ve solo su sucursal y el Repartidor solo sus salidas, y ningún parámetro amplía ese alcance.

### Protección CSRF

Como la sesión viaja en una cookie, el navegador la manda también cuando otro sitio dispara un pedido hacia la API. La defensa se apoya en el origen del pedido y no usa un token CSRF aparte, porque el frontend y la API comparten origen. Sigue la guía de [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), que pone la cabecera `Sec-Fetch-Site` como señal principal y `SameSite` como defensa adicional.

1. **Cookie de sesión:** `HttpOnly; Secure; SameSite=Strict; Path=/l/{slug}`, sin atributo `Domain` (queda atada al host `app.<dominio>`, así que ni el panel `admin.<dominio>` ni otros subdominios la reciben). Con `Strict`, la primera carga al entrar desde un enlace externo, como uno enviado por WhatsApp o por email, llega sin cookie. No molesta mientras la página no dependa de la sesión para cargar, como en una SPA: los pedidos a la API que hace después ya son del mismo sitio y llevan la sesión.
2. **`GET` nunca modifica datos**, tampoco el stream de eventos (`/l/{slug}/api/v1/events`, que usa la misma cookie). Es la regla que permite apoyarse en `SameSite` como defensa adicional.
3. **Verificación en `POST`, `PUT`, `PATCH` y `DELETE`**, antes de llegar al servicio:
   - Si llega `Sec-Fetch-Site`, solo se acepta `same-origin`. `same-site` y `cross-site` se rechazan.
   - Si la cabecera no llega (navegadores viejos), se compara `Origin` con `https://app.<dominio>`, y si falta se usa el origen de `Referer`. La comparación es exacta sobre el origen completo, para que `app.<dominio>.otro.com` no pase. Sin ninguno de los dos, o con `Origin: null`, se rechaza.
   - El rechazo responde 403 `csrf_rejected`.
4. **Cuerpos solo en JSON.** Un pedido con cuerpo sin `Content-Type: application/json` recibe 415. Un formulario de otro sitio no puede mandar ese tipo sin un preflight de CORS.
5. **Sin CORS.** El servidor no manda `Access-Control-Allow-Origin`, así que ningún otro origen puede leer respuestas ni mandar pedidos con cuerpo JSON.
6. **El login también se verifica** (hay CSRF de login: forzar a alguien a entrar con la cuenta del atacante). Cada login crea un token de sesión nuevo, nunca reutiliza uno anterior.

**Excepciones.** El webhook de WhatsApp no usa cookie y se autentica con la firma del proveedor. El panel de plataforma aplica las mismas reglas con su propio host (admin.\<dominio>), su propia cookie y su propia tabla de sesiones.

**Cookie de soporte.** Las sesiones de soporte usan su propia cookie, `__Secure-support_sid`, con `HttpOnly; Secure; SameSite=Strict; Path=/l/{slug}` y `Max-Age` igual al tiempo restante de la sesión. Si llegan las dos cookies, gana la de soporte. Detalle en la sección API (Modo soporte).

**Qué no cubre.** Un XSS en el frontend anula todas estas defensas, así que el frontend no inserta HTML sin escapar y el servidor manda una política de contenido (CSP) restrictiva. Si más adelante hay un cliente en otro origen, por ejemplo una app nativa o un frontend en otro dominio, se reemplaza la cookie por un token en cabecera y se agrega un token CSRF.

### Endpoints por módulo

Esta sección lista los endpoints de cada módulo. Las rutas son relativas a `/l/{slug}/api/v1`, salvo las del panel de plataforma y el webhook de WhatsApp, que se indican aparte. Es una primera versión para revisar: el cuerpo exacto de cada pedido se termina de definir al implementar el módulo, con los esquemas de validación.

**Cómo leer las tablas**

- **Permiso.** Es el del catálogo de permisos. “Sesión” es cualquier usuario autenticado y “Público” no pide sesión. El alcance (el Encargado ve su sucursal, el Repartidor sus salidas) lo aplica el servicio, como en Autorización.
- **Sucursal.** Lo que pertenece a una sucursal lleva `branchId` en el cuerpo o en la consulta. Si el usuario no tiene rol en esa sucursal (`user_branch_roles`), la respuesta es 403 `permission_denied`.
- **Idem.** El endpoint exige la cabecera `Idempotency-Key`, según la tabla de Idempotencia. Los demás no la exigen.
- **Respuestas.** `GET` devuelve 200. Una creación devuelve 201 con el recurso. Una acción devuelve 200 con el recurso actualizado. `DELETE` devuelve 204. Todo `PATCH` lleva `version` en el cuerpo.
- **Local suspendido.** Toda escritura devuelve 403 `tenant_suspended`, salvo cerrar una caja abierta y registrar rendiciones.

#### Autenticación y sesión

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `POST /auth/login` | Público | `{ login, password }`. Crea la sesión y fija la cookie. Con límite de intentos por (local, usuario) y por IP. Si la clave es temporal, la respuesta trae `mustChangePassword: true`. |
| `POST /auth/activate` | Público | `{ token, password }`. Activa al primer Dueño con el link de un solo uso. |
| `POST /auth/logout` | Sesión | Revoca la sesión actual y borra la cookie. |
| `GET /auth/me` | Sesión | Usuario, sucursales con su rol, permisos efectivos por sucursal, estado del local y zona horaria. Es lo primero que pide el frontend. |
| `POST /auth/change-password` | Sesión | `{ currentPassword, newPassword }`. Revoca las demás sesiones del usuario. |
| `POST /auth/password-reset/request` | Público | `{ email }`, solo para el Dueño. Siempre 202 con el mismo mensaje, exista o no el email. |
| `POST /auth/password-reset/confirm` | Público | `{ token, newPassword }`. Revoca todas las sesiones del usuario. |
| `POST /auth/email-change/request` | Sesión (Dueño) | `{ newEmail, currentPassword }`. Envía la verificación a la dirección nueva. |
| `POST /auth/email-change/confirm` | Sesión (Dueño) | `{ token }`. |
| `GET /auth/sessions` | Sesión | Sesiones activas propias, con dispositivo y último uso. |
| `DELETE /auth/sessions/{id}` | Sesión | Cierra una sesión propia. |
| `GET /l/{slug}/support/enter?code=...` | Público, con código | Fuera de `/api/v1`. Página de confirmación sin efectos: muestra el local, el motivo y la duración, con el botón "Entrar en modo soporte". Responde con Referrer-Policy: no-referrer y Cache-Control: no-store. |
| `POST /l/{slug}/support/enter` | Público, con código | Fuera de `/api/v1`. Recibe el código en el cuerpo, lo canjea (un solo uso, vale unos 60 segundos), crea la sesión de soporte y redirige al local. Verifica que el Origin sea app.\<dominio>. Responde 422 `support_code_invalid` si el código no existe, ya se usó o venció (es el mismo error en los tres casos). |
| `POST /support/exit` | Sesión de soporte | Cierra la sesión de soporte antes de que venza. Es el único método distinto de GET que acepta una sesión de soporte. |

#### Local, ajustes, sucursales y medios de pago

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /tenant` | Sesión | Nombre, slug, plan, estado y límites (máximo de sucursales). |
| `GET /settings` | Sesión | Ajustes que usa el frontend: moneda, redondeo, envío fijo, tiempos, alertas, impresión y corte del día. No incluye credenciales. |
| `PATCH /settings` | `settings.manage` | Con `version`. Incluye los topes de descuento y de egreso. |
| `GET /branches` | Sesión | Las del alcance del usuario. |
| `GET /branches/{id}` | Sesión |  |
| `POST /branches` | `settings.manage` | 422 `plan_limit_reached` al llegar al máximo del plan. |
| `PATCH /branches/{id}` | `settings.manage` | Nombre, dirección, teléfono y horarios. |
| `DELETE /branches/{id}` | `settings.manage` | Baja. 422 `branch_in_use` si tiene caja abierta o pedidos en curso. |
| `GET /payment-methods` | Sesión |  |
| `POST /payment-methods`, `PATCH /payment-methods/{id}`, `DELETE /payment-methods/{id}` | `settings.manage` | La baja desactiva el medio y conserva los pagos históricos. |

#### Usuarios y roles

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /users` | `users.manage` | Filtros `roleId`, `branchId`, `active` y `q`. |
| `GET /users/{id}` | `users.manage` | Con sus sucursales y roles. |
| `POST /users` | `users.manage` | Crea el usuario con sus sucursales y roles, y le deja una clave temporal (ver Recuperación de contraseña). |
| `PATCH /users/{id}` | `users.manage` | Nombre y email, con `version`. |
| `PUT /users/{id}/branch-roles` | `users.manage` | `[{ branchId, roleId }]`, con `branchId` nulo para todas las sucursales. Reemplaza las asignaciones y rige desde el próximo request. |
| `DELETE /users/{id}` | `users.manage` | Desactiva al usuario y cierra sus sesiones. 422 `last_owner` si es el único Dueño. |
| `POST /users/{id}/reset-password` | `users.reset_password` | El Encargado solo puede hacerlo sobre Recepcionista y Delivery. Genera una clave temporal y cierra las sesiones del usuario. |
| `DELETE /users/{id}/sessions` | `users.manage` | Cierra todas las sesiones del usuario sin cambiar su clave. |
| `GET /roles` | `roles.manage` |  |
| `GET /roles/{id}` | `roles.manage` | Con sus permisos. |
| `POST /roles`, `PATCH /roles/{id}` | `roles.manage` | Nombre del rol, con `version` en el `PATCH`. |
| `PUT /roles/{id}/permissions` | `roles.manage` | `{ permissions: [codigo], version }`. Reemplaza el conjunto. 422 `system_role_locked` con el rol Dueño, cuyos permisos se calculan en el código. |
| `DELETE /roles/{id}` | `roles.manage` | 422 `role_in_use` si tiene usuarios asignados y `system_role_locked` si es un rol de sistema. |
| `GET /permissions` | `roles.manage` | Catálogo fijo de permisos con su descripción. |

#### Catálogo y precios

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /categories` | Sesión | Completas y ordenadas. |
| `POST /categories`, `PATCH /categories/{id}` | `catalog.manage` |  |
| `DELETE /categories/{id}` | `catalog.manage` | 422 `category_in_use` si tiene productos activos. |
| `PUT /categories/order` | `catalog.manage` | `{ ids: [...] }` en el orden nuevo. |
| `GET /products` | Sesión | Con variantes y precios, sin paginar. Filtros `categoryId`, `type`, `active`, `visibleInCatalog` y `q`. |
| `GET /products/{id}` | Sesión | Con variantes y extras aplicables. |
| `POST /products` | `catalog.manage` | Debe traer al menos una variante. El precio inicial lo fija quien crea. |
| `PATCH /products/{id}` | `catalog.manage` | Nombre, descripción, categoría y visibilidad. |
| `DELETE /products/{id}` | `catalog.manage` | Baja (`active = false`). |
| `GET /variants` | Sesión | Filtros `barcode`, `productId` y `q`. Es la búsqueda del lector de códigos en el POS. |
| `POST /products/{id}/variants` | `catalog.manage` |  |
| `PATCH /variants/{id}` | `catalog.manage` | Cambiar `price` exige además `prices.edit`. El código de barras es único por local: 409 `already_exists`. |
| `DELETE /variants/{id}` | `catalog.manage` | 422 `last_variant` si es la única activa del producto. |
| `GET /extras` | Sesión | Filtros `productId` y `categoryId`. |
| `POST /extras`, `PATCH /extras/{id}`, `DELETE /extras/{id}` | `catalog.manage` | Cambiar el precio fijo exige además `prices.edit`. |
| `PUT /extras/{id}/applicability` | `catalog.manage` | `{ productIds, categoryIds }`. Reemplaza a qué se puede agregar el extra. |
| `POST /prices/adjustments/preview` | `prices.edit` | Devuelve el precio anterior y el nuevo, sin guardar nada. |
| `POST /prices/adjustments` | `prices.edit` | Idem. `{ scope, targetIds, mode, value }`, con alcance variante, extra, categoría o general, y modo porcentaje o monto fijo. Escribe un `batch_id` común en `price_history`. |
| `GET /prices/history` | `prices.edit` | Filtros `variantId`, `extraId`, `batchId` y fechas. Con cursor. |
| `POST /products/{id}/image`, `DELETE /products/{id}/image` | `catalog.manage` | Fase 2. La forma de subir el archivo (por el servidor o con URL firmada de R2) se define junto con Imágenes de productos. |

#### Stock e insumos

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /stock/variants` | `stock.view` | `branchId` obligatorio. Cantidad y mínimo de las variantes con `track_stock`. Filtros `belowMinimum`, `productId` y `q`. Sin paginar. |
| `GET /stock/supplies` | `stock.view` | Igual, para insumos. |
| `PUT /stock/minimums` | `stock.adjust` | `[{ branchId, variantId o supplyId, minimum }]`. |
| `GET /stock/movements` | `stock.view` | Libro de movimientos. Filtros `branchId`, `type`, `variantId`, `supplyId`, `orderId` y fecha comercial. Con cursor. |
| `POST /stock/movements` | `stock.adjust` | Idem. `{ branchId, variantId o supplyId, type, quantity, reason }`. Tipos permitidos: compra, producción, ajuste, merma y devolución. La venta la genera el sistema con el pedido. En compra, producción y devolución la cantidad va positiva y el tipo fija el signo. En ajuste y merma el signo lo manda quien registra. |
| `GET /supplies` | `stock.view` | Filtros `q`, `active` y `belowMinimum`. |
| `GET /supplies/{id}` | `stock.view` | Con sus códigos de barras y el stock por sucursal. |
| `POST /supplies` | `supplies.create` | Alta rápida: nombre, unidad, mínimo, costo opcional y, si se quiere, un código de barras. |
| `PATCH /supplies/{id}`, `DELETE /supplies/{id}` | `stock.adjust` | Con `version` en el `PATCH`. La baja desactiva el insumo. |
| `POST /supplies/{id}/barcodes` | `supplies.create` | `{ code, presentation, quantityPerScan }`. 409 `already_exists` si el código ya existe en el local. |
| `DELETE /supply-barcodes/{id}` | `supplies.create` | Desactiva el código. |
| `GET /supply-barcodes/{code}` | `stock.view` | Resuelve un código leído: insumo, presentación y `quantityPerScan`. Si no existe, 404 y el frontend ofrece el alta rápida. |

#### Clientes

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /customers` | `orders.create` | Filtros `q` (nombre o teléfono) y `phone` exacto. Con cursor. |
| `GET /customers/{id}` | `orders.create` | Con sus direcciones. Los pedidos del cliente se piden con `GET /orders?customerId=`. |
| `POST /customers` | `orders.create` | `{ phone, name, notes }`. Si el teléfono ya existe, 409 `already_exists` con el `customerId` existente, para que el frontend lo reutilice. |
| `PATCH /customers/{id}` | `orders.edit` | Con `version`. No hay baja de clientes. |
| `POST /customers/{id}/addresses` | `orders.edit` | `{ address, reference }`. |
| `PATCH /customer-addresses/{id}`, `DELETE /customer-addresses/{id}` | `orders.edit` | Los pedidos ya tomados no cambian, porque guardan una copia de la dirección. |

#### Pedidos

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /orders` | `orders.view` | Listado resumido. Filtros `status`, `type`, `channel`, `branchId`, `customerId`, `paymentStatus`, `requiresReview`, `deliveryRunId`, `q` (número) y fecha comercial; sin rango devuelve la fecha comercial actual. El Repartidor solo ve los pedidos de sus salidas. Con cursor. |
| `GET /orders/{id}` | `orders.view` | Detalle completo: ítems con sus extras, pagos, historial de estados e intentos de entrega. |
| `POST /orders` | `orders.create` | Idem, más `clientRequestId` en el cuerpo. `{ branchId, type, channel, customerId, address, items, notes, discount, occurredAt }`. Cada ítem lleva `variantId` (o nombre y precio si es libre), `quantity`, `note` y sus extras. El servidor congela nombres y precios, calcula los totales, asigna el número y descuenta stock en la misma transacción. |
| `PATCH /orders/{id}` | `orders.edit` | Con `version`. Ítems, notas, cliente, dirección y descuento. Solo mientras esté en Recibido o En preparación; después, 422 `order_not_editable`. |
| `POST /orders/{id}/status` | `orders.change_status` | `{ to }` con `preparing` o `ready`. Si el pedido ya está en ese estado responde 200 y gana el primer cambio. Una transición no permitida da 422 `invalid_transition`. |
| `POST /orders/{id}/deliver` | `orders.deliver` | Marca Entregado desde Listo (mostrador y retiro) o desde En camino (delivery). El Repartidor solo en sus pedidos. Con el pago pendiente avisa en `warnings` o responde 422 `payment_pending`, según la configuración del local. Corregir un Entregado por error (reversión) lo hacen solo el Encargado o el Dueño, con motivo y auditoría. |
| `POST /orders/{id}/not-deliver` | `orders.deliver` | `{ reason, note? }`. El motivo es obligatorio y sale de una lista corta (el cliente no retiró, no atendió, dirección incorrecta, otro), con texto libre opcional. Pasa de Listo o En camino a No entregado y suma un registro en `delivery_attempts`. Un pedido que todavía se prepara se cancela, no se marca. Deshacerlo requiere `orders.revert_undelivered` (endpoint siguiente). El pago pendiente no afecta este cambio. |
| POST /orders/{id}/revert-not-delivered | orders.revert\_undelivered | { reason } obligatorio. Deshace un No entregado y deja el pedido en el estado anterior (Listo o En camino). Se guarda como un registro nuevo en order\_status\_history y queda en auditoría con usuario, hora y motivo. Sin el permiso responde 403 permission\_denied con el permiso faltante. |
| `POST /orders/{id}/cancel` | `orders.cancel` u `orders.cancel_late` | `{ reason }` obligatorio. Desde Recibido o En preparación alcanza `orders.cancel`; desde Listo o En camino hace falta `orders.cancel_late`. Los movimientos de stock se ajustan en la misma transacción. |
| `POST /orders/{id}/payments` | `orders.edit` | Idem. `{ methodId, amount, cashTendered }`. El efectivo exige una sesión de caja abierta (422 `cash_session_closed`). El efectivo de un delivery queda pendiente hasta la rendición. |
| `POST /orders/{id}/review` | `orders.edit` | Marca como revisado un pedido del bot y limpia `requires_review`. |
| `POST /orders/{id}/print` | `orders.print` | `{ document }` con `comanda`, `ticket` o `precuenta`. Devuelve los datos para imprimir y registra la impresión. El contenido exacto queda en Impresión. |

- **Descuentos.** Se mandan en el alta o en la edición. Hasta el tope del local alcanza `orders.discount`. Por encima del tope hace falta `orders.discount_over_limit`; sin él, 403 `permission_denied` con el permiso y el tope en la respuesta.
- **Carga posterior.** `occurredAt` en el alta fija la hora real del pedido y, con ella, la fecha comercial. Dentro del turno abierto alcanza `orders.backdate`; fuera de él hace falta `orders.backdate_any`. Si no, 422 `backdate_outside_shift`.
- **Reintento de entrega.** Un pedido en No entregado vuelve a En camino al sumarlo a una salida (`POST /delivery/runs`), no con `status`.
- **Pantalla en vivo.** Los cambios llegan por el stream de eventos (`GET /events`, ver más abajo), que pide `orders.view`.

#### Delivery

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /delivery/couriers` | `delivery.assign` | Repartidores activos de la sucursal (`branchId`), con su cantidad de salidas abiertas. |
| `GET /delivery/runs` | `delivery.assign` u `orders.view` | Filtros `branchId`, `courierId`, `open` y fecha comercial. El Repartidor solo ve las suyas. |
| `GET /delivery/runs/{id}` | `delivery.assign` u `orders.view` | Con sus pedidos. |
| `POST /delivery/runs` | `delivery.assign` | Idem. `{ branchId, courierId, orderIds }`. Pasa los pedidos de Listo a En camino en una sola transacción. También es el reintento de un pedido en No entregado. Si alguno no es de delivery o no está listo, 422 `invalid_transition` indicando cuál. |
| `POST /delivery/runs/{id}/orders` | `delivery.assign` | `{ orderIds }`. Suma pedidos listos a una salida abierta. |
| `GET /delivery/couriers/{id}/pending-settlement` | `settlements.create` | `branchId`. Efectivo pendiente del repartidor y monto esperado de la rendición. |
| `GET /delivery/settlements` | `settlements.create` | Filtros `branchId`, `courierId`, `cashSessionId` y fecha comercial. Con cursor. |
| `POST /delivery/settlements` | `settlements.create` | Idem. `{ branchId, courierId, cashSessionId, receivedAmount, note }`. Calcula el monto esperado, marca los pagos como cobrados, guarda la diferencia (sin estados ni seguimiento) y genera el movimiento de caja de categoría rendición. Con el local suspendido se puede registrar. |

#### Caja

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /cash/registers` | Sesión | Cajas de la sucursal (`branchId`), con el estado de su sesión. |
| `POST /cash/registers`, `PATCH /cash/registers/{id}`, `DELETE /cash/registers/{id}` | `settings.manage` |  |
| `GET /cash/sessions` | `cash.open` | Filtros `registerId`, `branchId`, `status` y fecha comercial. Con cursor. |
| `GET /cash/sessions/current` | `cash.open` | `registerId`. La sesión abierta con el efectivo esperado hasta el momento. 404 si no hay. |
| `GET /cash/sessions/{id}` | `cash.open` | Con movimientos, cobros por medio y desglose. |
| `POST /cash/sessions` | `cash.open` | Idem. `{ registerId, openingAmount }`. Una sola sesión abierta por caja: 409 `cash_session_open`. Registra la diferencia contra el cierre anterior. La fecha comercial es la de la apertura. |
| `POST /cash/sessions/{id}/close` | `cash.close` | Idem. `{ countedAmount, byMethod, reason }`, con `reason` obligatorio si hay diferencia. 422 `pending_items` si falta cargar algo pendiente. Al cerrar queda inmutable. Se puede cerrar con el local suspendido. |
| `POST /cash/sessions/{id}/reopen` | `cash.reopen` | `{ reason }`. Queda en auditoría. |
| `GET /cash/movements` | `cash.open` | `sessionId` obligatorio. Con cursor. |
| `POST /cash/movements` | `cash.movements` | Idem. `{ sessionId, type, category, concept, amount, methodId, receipt }`. Las categorías manuales son gasto, retiro, fondo de cambio, proveedor y ajuste; cobro de pedido y rendición las genera el sistema. Por encima del tope del local hace falta `cash.movements_over_limit`, y el retiro del dueño exige `cash.owner_withdrawal`. Con la sesión cerrada, 422 `cash_session_closed`. |

#### Reportes, exportación y auditoría

Todos los reportes piden `reports.view`, exigen `businessDateFrom` y `businessDateTo`, aceptan `branchId` (el Encargado solo ve su sucursal) y devuelven datos agregados sin paginar. Las sumas se hacen en SQL y los importes salen como string.

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /reports/sales` | `reports.view` | Ventas, cantidad de pedidos y ticket promedio. `groupBy` con `day`, `channel`, `type`, `paymentMethod` o `branch`. |
| `GET /reports/products` | `reports.view` | Ranking de productos y variantes: unidades, ingresos y margen, con el costo manual de cada variante. Filtro `categoryId`. |
| `GET /reports/extras` | `reports.view` | Extras vendidos: cantidad e ingresos. |
| `GET /reports/controls` | `reports.view` | Control por usuario y período: cancelaciones (con motivo y estado de origen), descuentos y quién los aprobó, egresos de caja y pedidos cargados después. En cada descuento y egreso aprobado por encima del tope queda registrado el tope vigente en ese momento. |
| `GET /reports/losses` | `reports.view` | Pérdidas por pedidos no entregados y mermas, con su costo. |
| `GET /reports/delivery-settlements` | `reports.view` | Diferencias de rendición por repartidor y por período. |
| `GET /reports/stock` | `reports.view` | Stock bajo el mínimo y rotación, a partir del libro de movimientos. |
| `GET /exports/{dataset}` | `data.export` | Archivo CSV de `orders`, `customers`, `catalog`, `cash` o `stock-movements`, con el rango de fechas que corresponda. |
| `GET /audit` | `audit.view` | Filtros `userId`, `branchId`, `entity`, `entityId`, `action`, `createdFrom` y `createdTo`. Con cursor. El Encargado ve solo su sucursal. Es de solo lectura: el registro lo escriben los servicios, no la API. |
| `GET /support-access-log` | `settings.manage` | Historial de accesos de soporte al local: administrador, motivo, inicio, fin y cómo terminó. Con cursor. Solo lectura. Visible solo para el Dueño. |

El resumen de cierre de caja no es un reporte aparte: viene en `GET /cash/sessions/{id}`.

#### Plataforma

Vive en `https://admin.<dominio>/api/v1`, con sesión y cookie propias. En el MVP los locales se dan de alta con el script (`create_tenant`), así que no hay endpoint de alta. Todos los endpoints piden sesión de administrador de plataforma y cada acción de escritura queda en `platform_audit_log`.

| Endpoint | Acceso | Notas |
| --- | --- | --- |
| `POST /auth/login` | Público | `{ email, password }`. Si el administrador tiene 2FA, responde que falta el segundo factor. |
| `POST /auth/2fa/verify` | Sesión parcial | `{ code }`. |
| `POST /auth/logout`, `GET /auth/me` | Sesión |  |
| `GET /tenants` | Sesión | Filtros `state`, `planId` y `q`. Con cursor. |
| `GET /tenants/{id}` | Sesión | Plan, cantidad de sucursales, estado y su historial. |
| `POST /tenants/{id}/state` | Sesión | `{ state, reason }` con prueba, activo, en mora, suspendido o cancelado. Suspender revoca las sesiones de los roles que pierden el acceso. |
| `POST /tenants/{id}/activation-link` | Sesión | Genera un link nuevo de un solo uso para el Dueño, si el anterior venció o se usó. |
| `GET /plans` | Sesión |  |
| `GET /platform-audit` | Sesión | Con cursor. |
| `POST /tenants/{id}/support-sessions` | Sesión | `{ reason }` obligatorio. Abre una sesión de soporte de solo lectura de 30 minutos y devuelve un código de un solo uso que vale unos 60 segundos. Responde 409 `support_session_active` si el administrador ya tiene una sesión abierta. |

El acceso de soporte a un local (modo soporte, de solo lectura) tiene sus propios endpoints, que se describen en la subsección siguiente.

#### Modo soporte (solo lectura)

Permite diagnosticar un problema en un local sin usar nunca la contraseña de un usuario y sin acceso permanente a ningún local.

**Cómo se otorga**

1. Un administrador de plataforma (`platform_admins`), desde `admin.<dominio>`, elige el local y escribe un motivo obligatorio (por ejemplo, "el dueño reportó que no ve pedidos").
2. `POST /tenants/{id}/support-sessions` crea un registro en `support_sessions` y devuelve un código de un solo uso que vale unos 60 segundos.
3. El navegador va a `app.<dominio>/l/{slug}/support/enter?code=...`. Ese `GET` solo muestra una página de confirmación, sin efectos, con el local, el motivo y la duración, y el botón "Entrar en modo soporte".
4. El botón hace `POST /l/{slug}/support/enter` con el código en el cuerpo. El backend verifica que el `Origin` sea `app.<dominio>`, canjea el código, crea una sesión con `kind = 'support'` (token opaco hasheado) y redirige al local.
5. La sesión de soporte no tiene `user_id`. Usa el mismo mecanismo de RLS que las demás, con el `app.tenant_id` del local.

**Reglas**

- Solo lectura, forzada en el servidor: un middleware rechaza cualquier método distinto de `GET` en sesiones de soporte, salvo cerrar la propia sesión.
- Vencimiento fijo de 30 minutos, sin renovación automática. Para seguir hay que abrir otra sesión con otro motivo.
- Una sesión de soporte activa por administrador. Si ya tiene una, el pedido responde 409 `support_session_active`.
- Botón "Salir del modo soporte" para cerrar antes de tiempo (`POST /support/exit`).
- Cartel permanente en pantalla: "Modo soporte, solo lectura, vence a las HH:MM".
- No se muestran hashes de contraseña, tokens de sesión ni secretos de integraciones (WhatsApp, email, almacenamiento). Lo demás se ve igual que el Dueño.
- También se puede mirar un local suspendido o cancelado, en modo lectura.

**Rutas permitidas**

- Las sesiones de soporte solo pueden usar una lista explícita de rutas `GET` de lectura: pedidos, caja, productos y reportes en pantalla. Cualquier ruta que no esté en la lista se rechaza. La lista exacta se fija al implementar.
- Una ruta nueva queda bloqueada por defecto hasta que se la agregue a la lista.
- Las exportaciones no están en la lista: responden 403 con el código `support_mode_forbidden`.
- Si más adelante hace falta ver un dato de contacto, se muestra enmascarado (por ejemplo, teléfono parcial) en vez de abrir la exportación.
- La página de confirmación del canje lleva `Referrer-Policy: no-referrer` y `Cache-Control: no-store`.

**Cookie de soporte**

- Nombre `__Secure-support_sid`. No se usa el prefijo `__Host-` porque exige `Path=/` y esta cookie lleva el path del local.
- Atributos: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/l/{slug}`, y `Max-Age` igual al tiempo restante de la sesión (30 minutos como máximo).
- Si llegan las dos cookies (soporte y sesión de usuario), gana la de soporte. El cartel de modo soporte tiene que estar visible.
- Al salir del modo soporte se borra solo la cookie de soporte; la sesión de usuario no se toca.
- Recomendación operativa: entrar a soporte desde un perfil de navegador aparte.

**Auditoría**

- Cada acceso queda registrado: quién, a qué local, cuándo, motivo, cuándo terminó y cómo (venció o salió).
- El Dueño tiene una pantalla "Accesos de soporte" con ese historial (`GET /support-access-log`). No se puede editar ni borrar.
- Internamente se registran también las rutas consultadas durante la sesión (log interno, no visible al Dueño).
- Aviso por email al Dueño al entrar: opcional, queda para la fase 2.

**Autorización previa del Dueño**

No se pide en el MVP, porque haría lento el soporte urgente. Los términos de uso informan que el soporte puede acceder en modo lectura y que el acceso queda registrado y es visible para el Dueño.

**Límite conocido**

En modo lectura se puede diagnosticar pero no corregir. Si un caso se repite, más adelante se agregan acciones puntuales de soporte, una por una y auditadas, nunca un modo de escritura general.

#### WhatsApp (fase 2)

Contrato de la v1. La cola usa pg-boss sobre Postgres, con el payload crudo en `whatsapp_inbox` como fuente de verdad y los envíos en `whatsapp_outbox`; ambas son tablas internas y no tienen endpoints propios. Los mensajes libres solo salen dentro de la ventana de 24 horas; las plantillas son de la fase 2.

| Endpoint | Acceso | Notas |
| --- | --- | --- |
| `GET /webhooks/whatsapp` | Público | En `app.<dominio>`, fuera del slug. Verificación del webhook que pide Meta. |
| `POST /webhooks/whatsapp` | Firma de Meta | En `app.<dominio>`, fuera del slug. Valida la firma, guarda el payload crudo en `whatsapp_inbox` y responde exactamente 200. Un job de pg-boss lo procesa después: resuelve el local por `phone_number_id` y deduplica por `messages[].id` y por `statuses[].id` más el estado. Con el local suspendido manda el mensaje fijo. |
| `GET /whatsapp/conversations` | `whatsapp.inbox` | Filtros `status` y `q`. Con cursor. El filtro `status` incluye `blocked` para los mensajes bloqueados por ventana cerrada. |
| `GET /whatsapp/conversations/{id}/messages` | `whatsapp.inbox` | Con cursor. |
| `POST /whatsapp/conversations/{id}/messages` | `whatsapp.inbox` | Idem. Texto libre solo dentro de la ventana de 24 horas. Con la ventana cerrada responde 422 `whatsapp_window_closed` y el mensaje queda en `whatsapp_outbox` como bloqueado, sin enviarse. |
| POST /whatsapp/messages/{id}/resolve | whatsapp.inbox | Marca como resuelto un mensaje bloqueado (por ejemplo, tras llamar al cliente). Motivo obligatorio. |
| `POST /whatsapp/conversations/{id}/takeover`, `POST /whatsapp/conversations/{id}/release` | `whatsapp.inbox` | Recepción toma la conversación o se la devuelve al bot. |
| `GET /whatsapp/account`, `PUT /whatsapp/account` | `settings.manage` | Alta manual: ID de cuenta, ID de número y clave de acceso. La clave nunca se devuelve en la respuesta. La respuesta incluye el consumo del mes por categoría. |

### Actualización en vivo de la pantalla de recepción

**Decisión:** se actualiza en vivo desde el MVP con Server-Sent Events (SSE), en lugar de WebSockets.

- Los eventos (pedido nuevo, cambio de estado) van solo del servidor al navegador y llevan el tipo y el ID. La pantalla recarga lo que cambió.
- Las acciones siguen yendo por REST.
- El servidor envía una señal cada unos 25 segundos para que ningún proxy corte la conexión.
- Si el stream se corta, la pantalla recarga la lista y consulta cada pocos segundos hasta reconectar.
- Los eventos se filtran por tenant y sucursal, la cookie de sesión autentica el stream y la suscripción valida permisos.
- Con una sola instancia del servidor alcanza con una cola en memoria. Con varias, se usa `LISTEN/NOTIFY` de PostgreSQL.
- WebSockets solo si más adelante hace falta comunicación en ambos sentidos.
- La conexión abierta sirve además como señal de que recepción está conectada, para la detección de local desconectado de la fase 2.
- El endpoint es `GET /events`, bajo `/l/{slug}/api/v1`. Responde `text/event-stream`, pide `orders.view` y no cambia datos.

## Integraciones

Dos integraciones condicionan el diseño del backend. El detalle queda pendiente.

### WhatsApp (fase 2)

- **Capa aislada:** el envío y la recepción de mensajes viven detrás de una interfaz propia, separada del resto del bot. Así se puede migrar a un proveedor o a Embedded Signup sin reescribir la lógica del bot.
- **Alta manual por tenant:** cada local carga en su configuración el ID de cuenta, el ID de número y la clave de acceso (`whatsapp_accounts`).
- **Desarrollo:** el bot se desarrolla y prueba con el número de prueba que da Meta.
- **Webhook:** debe responder rápido y procesar de forma idempotente, usando el ID del mensaje como clave única para no repetir un mensaje que Meta reenvíe.
- **Definido:** la cola de procesamiento, el manejo de la ventana de 24 horas y las plantillas, en la subsección siguiente.
- **A definir (IA del bot):** proveedor y modelo, funciones que puede llamar y validación de lo que devuelve antes de crear el pedido, comportamiento si falla o tarda (propuesta a evaluar: pasar la conversación a "esperando humano"), qué datos del cliente se envían al proveedor y costo por local. El flujo general (la IA interpreta el texto libre, un flujo estructurado confirma, precios y disponibilidad salen siempre de la base) está en el documento del MVP. Se define antes de implementar el bot.

#### Cola, ventana de 24 horas y plantillas

**Cola de procesamiento**

- **Motor:** pg-boss sobre Postgres. No se usa Redis ni BullMQ.
- **Entrada:** el inbox crudo (`whatsapp_inbox`) es la fuente de verdad. El webhook guarda el payload tal cual llega y responde exactamente `200` (Meta trata cualquier otro código, incluso 202 o 204, como fallo y reintenta hasta 7 días). Un job lo procesa después. Meta no reenvía webhooks viejos ni permite consultarlos, por eso se guarda todo antes de procesar.
- **Deduplicación:** `messages[].id` para mensajes entrantes y `statuses[].id` más el estado para los estados. Las claves se guardan al menos 7 días, que es lo que dura el reintento de Meta. La entrega es al menos una vez y sin garantía de orden, así que los estados se tratan como observaciones y no como una secuencia.
- **Salida:** los mensajes salientes van a `whatsapp_outbox`, con estado, categoría del mensaje y cantidad de reintentos.
- **Orden por conversación:** un solo job activo por conversación, con lock de Postgres por id de conversación.
- **Espaciado:** al menos 6 segundos entre mensajes al mismo cliente. Si Meta devuelve el error `131056` (límite por par), se reintenta solo a ese cliente, con espera. El límite por número (80 mensajes por segundo) no es una preocupación para un local.
- **Tenant en los jobs:** el payload del job guarda `tenant_id`, y el worker hace `set_config('app.tenant_id', ...)` al procesar, como cualquier otra operación.

**Ventana de 24 horas**

- La ventana se abre cuando el cliente escribe o llama, y se reinicia a 24 horas con cada mensaje nuevo. Fuera de ella el bot no manda mensajes libres: en el MVP el mensaje queda bloqueado (las plantillas son de la fase 2).
- `conversations.window_expires_at` se actualiza con cada mensaje entrante. Se toma la ventana como cerrada 1 o 2 minutos antes del vencimiento real, para evitar carreras.
- Dentro de la ventana el bot manda mensajes libres, no plantillas. Las plantillas de utilidad dentro de la ventana se cobran desde el primer mensaje.
- Con la ventana cerrada, el bot nunca intenta mandar un mensaje libre. El mensaje queda como `bloqueado` y aparece en la bandeja para que lo resuelva una persona (llamar o escribir desde el celular del local).

**Plantillas**

- Fuera del MVP: el bot solo responde dentro de la ventana, y los avisos a clientes de otros canales (por ejemplo, "tu pedido salió") no se mandan.
- Pasan a la fase 2: confirmación de pedido programado, estado del pedido y aviso de no entregado, todas de categoría utilidad y sin lenguaje promocional (Meta reclasifica como marketing lo promocional, y eso cuesta más). No habrá plantillas de marketing.
- Cada local tiene su propia cuenta de WhatsApp Business, así que las plantillas se crean y se aprueban en cada una.

**Costo de mensajería**

- Desde el 1 de octubre de 2026, Meta cobra por mensaje los mensajes libres dentro de la ventana y las plantillas de utilidad dentro de la ventana. Cada número tiene 1.000 mensajes de servicio gratis por mes.
- **Lo paga cada local.** Cada local carga su método de pago en Meta y Meta le factura directamente. El SaaS no cobra ni absorbe mensajería.
- El Dueño tiene que saberlo desde el alta del local: según lo definido, sin método de pago, pasados los 1.000 mensajes gratuitos Meta deja de entregar los mensajes de servicio.
- Cada mensaje saliente guarda su categoría (servicio, utilidad o marketing) para mostrar el consumo por local.
- Alerta al Dueño al acercarse a los 1.000 mensajes del mes, y alerta si un envío falla por falta de pago.
- El bot usa pocos mensajes: botones y listas en lugar de texto largo.

**A verificar**

- La tarifa vigente para Argentina. La cifra de USD 0,026 por mensaje de servicio sale de una tabla de un revendedor y no de Meta; confirmarla antes de dar números a un local.
- Que, sin método de pago, Meta deje de entregar mensajes de servicio luego de los 1.000 gratuitos.
- Los tiempos de aprobación de plantillas, antes de la fase 2.

### Impresión

- **Desde el navegador:** el backend entrega los datos del ticket y el frontend los muestra con estilos de impresión en formato ticket. No hay programa local.
- **Comanda automática del bot:** requiere que Chrome en recepción use el modo de impresión en kiosco (`--kiosk-printing`).
- **Por definir:** ancho de papel soportado, contenido exacto de la comanda y la precuenta, y la marca MODIFICADO en las reimpresiones.

### Correo electrónico

- **Decisión: Resend.** El envío de email del MVP se hace con Resend, solo para el Dueño: link de activación del alta, código de recuperación de contraseña y aviso de cambio de clave. Los demás roles no reciben emails.
- **Capa aislada:** el envío va detrás de una interfaz propia, igual que la de WhatsApp, para cambiar de proveedor sin tocar el resto.
- **Costos (cifras del relevamiento, no las verifiqué: reconfirmar en el sitio):** el plan gratuito permite 100 emails por día y 3.000 por mes, muy por encima del volumen de los primeros locales. El plan Pro cuesta USD 20 al mes por 50.000 emails, con USD 0,90 por cada mil adicionales, y es el paso siguiente.
- **Condiciones:** dominio propio con SPF y DKIM configurados, y revisar el plan cuando el uso se acerque a los topes gratuitos.

### Imágenes de productos

**Almacenamiento: Cloudflare R2.** La capa gratuita incluye 10 GB al mes, 1 millón de operaciones de escritura y 10 millones de lectura por mes. Un local de 100 productos ocupa unos 12 MB (estimación propia), así que hay margen para muchos locales. No hay cargo por egreso, algo que importa porque el catálogo público lee las imágenes muchas más veces de las que se suben. Pasada la capa gratuita, el almacenamiento cuesta USD 0,015 por GB al mes (cifras del relevamiento, no verificadas: reconfirmar en el sitio). La API es compatible con S3, así que se puede migrar a otro proveedor sin reescribir el código.

- No se guardan en PostgreSQL (infla la base y los backups) ni en el disco del servidor de la app (en muchos hostings se pierde en cada despliegue).
- Se usa almacenamiento Standard, porque la capa gratuita no aplica al de acceso poco frecuente.
- Se sirven desde un dominio de CDN propio. Conviene que el dominio use el DNS de Cloudflare, y hay que verificarlo al configurarlo.
- En la base va solo la clave del archivo, nunca la URL completa. Las claves tienen la forma `tenants/{tenant_id}/products/{uuid}.webp`, con UUID generado por el servidor; el nombre original se descarta.
- La cuenta se abre recién al construir la subida de imágenes, que es de la fase 2.

**Tabla `media_assets`** (en lugar de un campo suelto en `products`): `id`, `tenant_id`, `key`, tamaño, MIME, ancho, alto y creado por. `products.image_id` apunta a ella. Sirve para medir la cuota de cada tenant, limpiar archivos huérfanos y auditar. Tiene RLS.

| Regla | Valor propuesto |
| --- | --- |
| Formatos de entrada | JPEG, PNG y WebP, verificados por el contenido real y no por la extensión |
| Rechazados | SVG (puede llevar scripts) y GIF animados |
| Tamaño máximo de subida | 5 MB |
| Procesamiento (`sharp`) | Limitar los píxeles de entrada, borrar los datos EXIF (incluye la ubicación GPS), rotar según la orientación y convertir a WebP |
| Tamaños generados | Imagen de 1200 px de lado mayor y miniatura de 400 px |
| Cantidad | Una imagen principal por producto; las variantes la comparten |
| Cuota | Tope de almacenamiento por tenant, configurable por plan (valor inicial: unos cientos de MB) |

**Cómo se sirven.**

- Directo desde un CDN con dominio propio (por ejemplo `cdn.<dominio>`), no a través de la API.
- Las claves con UUID no se pueden adivinar. Son fotos que igual se muestran en un catálogo público, así que no se firman: riesgo aceptado y escrito.
- Caché largo e inmutable. Al reemplazar una imagen se crea una clave nueva.
- El bot de WhatsApp puede enviar la foto con ese mismo enlace público (Meta necesita una URL HTTPS accesible). Los tickets y comandas no llevan imágenes.

**Seguridad de la subida.** Solo con permiso (por ejemplo `catalog.manage`) y con límite de frecuencia. Al reemplazar o borrar un producto, un proceso de limpieza elimina el archivo del bucket a los pocos días. Los pedidos no dependen de la imagen porque guardan nombre y precio congelados. Los backups de imágenes pueden ser menos exigentes que los de la base.

## Pruebas, entornos y despliegue

### Pruebas

| Tipo | Qué cubre | Herramienta |
| --- | --- | --- |
| Unitarias | Reglas puras: cálculo de totales, máquina de estados del pedido, ajustes de precio | Vitest |
| Integración | Servicios y repositorios contra PostgreSQL real en contenedor, con las migraciones aplicadas | Vitest y Docker |
| API | Endpoints completos: autenticación, permisos, formato de errores | Supertest |
| Aislamiento entre tenants | Con datos de dos tenants, un tenant nunca ve, modifica ni borra filas del otro, y sin `app.tenant_id` no ve nada | Vitest sobre PostgreSQL real |
| Concurrencia | Dos ventas simultáneas del último producto, numeración de pedidos sin huecos ni duplicados, una sola caja abierta por sucursal | Vitest sobre PostgreSQL real |

Las pruebas de aislamiento y de concurrencia son las que más protegen el producto, porque RLS y las operaciones atómicas solo se pueden probar contra una base real y no con simulaciones.

### Entornos

- **Desarrollo:** Docker Compose con la app y PostgreSQL, con datos de prueba (seed) de dos tenants.
- **Staging:** copia de producción sin datos reales, para probar migraciones y la integración con WhatsApp.
- **Producción:** el local piloto.

### Migraciones

- Prisma Migrate genera las migraciones en `prisma/migrations/`; las que llevan políticas RLS, índices parciales o `CHECK` se crean con `--create-only` y se completan a mano en SQL. Se aplican en orden y no se editan una vez publicadas.
- Las políticas RLS y los permisos del rol de la aplicación viajan en las migraciones, no se configuran a mano.
- La aplicación se conecta con un rol sin privilegios de superusuario ni dueño de las tablas. Las migraciones las ejecuta otro rol.
- Cambios destructivos (borrar columnas) en dos pasos: primero se deja de usar, y en un despliegue posterior se elimina.

### Integración y despliegue continuo

1. En cada push: lint, chequeo de tipos, pruebas y construcción de la imagen en GitHub Actions.
2. Al integrar en la rama principal: despliegue automático a staging.
3. A producción: despliegue manual aprobado, con las migraciones aplicadas antes de iniciar la nueva versión.

### Backups y observabilidad

- Backups automáticos diarios de PostgreSQL con retención definida, y una restauración de prueba antes de salir al piloto.
- Endpoint de salud (`/health`) que verifica la conexión a la base.
- Logs estructurados en JSON con id de request y `tenant_id`, y alertas ante errores 500 repetidos. Herramienta de monitoreo: Better Stack, plan gratuito (ver Monitoreo).

### Hosting

El piloto es un solo local en Argentina, así que el criterio es: cerca (latencia), barato, simple de operar y compatible con lo que ya definimos. Los precios son de lista, en USD, consultados el 2026-11-24, y hay que confirmarlos en la página del proveedor antes de contratar.

**Qué necesita el sistema**

- Node 24 y PostgreSQL ≥13, con un rol de aplicación sin privilegios y otro rol distinto para migrar.
- RLS con `set_config(..., true)` dentro de cada transacción. Funciona detrás de un pooler en modo transacción mientras `withTenant()` use siempre una transacción; si el pooler no lo soporta bien, se usa conexión directa.
- Conexiones SSE abiertas con heartbeat de 25 s: el proveedor no debe cortar conexiones ociosas antes de eso.
- Backups diarios con restauración probada, y un `/health` que verifique la base.
- Una instancia en el MVP; `LISTEN/NOTIFY` y pg-boss recién en fase 2.

**Opciones revisadas**

| Opción | Región cercana | Precio de lista | Observaciones |
| --- | --- | --- | --- |
| VPS en São Paulo (por ejemplo Vultr) | São Paulo | 1 vCPU / 2 GB cerca de USD 18; 2 vCPU / 4 GB cerca de USD 36 por mes (según comparadores, no verificado en la página del proveedor) | App, Postgres y proxy en una sola máquina. Control total de roles y extensiones, pero los backups, las actualizaciones y la seguridad del servidor son tuyos. |
| Fly.io | São Paulo (gru) | Máquina shared-cpu-1x de 256 MB: USD 3,54 por mes en gru; volúmenes USD 0,15 por GB; Postgres administrado desde USD 38 por mes (plan Basic, 1 GB) | No confirmé si el Postgres administrado tiene recargo en gru. 256 MB es poco para Node con Prisma; hay que dimensionar. |
| Supabase (solo como base) | São Paulo (sa-east-1) | Plan Pro USD 25 por mes más cómputo; incluye backups diarios por 7 días | Ofrece pooler y conexión directa. Trae mucho que no usamos (auth, storage). La app iría en otro lado. |
| Render | No tiene São Paulo; las más cercanas son Virginia y Ohio | Sin verificar | Latencia de EE. UU. (más de 100 ms). Descartada para el piloto. |
| Railway | No tiene São Paulo como región de despliegue | Sin verificar | Descartada por la misma razón. |
| Neon | Sin verificar | Sin verificar | No pude abrir su página de planes; queda sin evaluar. |

La distancia pesa: de Buenos Aires a São Paulo hay unos 1.680 km, con un piso de latencia real cercano a 24 ms; a EE. UU. es bastante más (más de 100 ms). Con SSE y pantallas que consultan seguido, conviene estar en São Paulo.

**Propuesta provisional (decisión final pendiente hasta el despliegue)**

La elección de proveedor se deja para cuando el sistema esté cerca de desplegarse: los precios, las regiones y la situación de pagos cambian, y hoy no hay un local real que dimensionar. Lo de abajo es el punto de partida que se usaría si hubiera que decidir ya, no una definición. Nada del diseño depende de esta elección: la app solo necesita un Postgres accesible por `DATABASE_URL` y corre igual en Docker Compose que en desarrollo. Al llegar el momento, se repite la verificación de la lista "A verificar antes de elegir".

Un VPS en São Paulo con Docker Compose (app, Postgres y un proxy con HTTPS automático como Caddy), por ser lo más barato y lo que menos restricciones impone a RLS, roles y SSE. Para compensar que lo operás vos:

- backup diario con `pg_dump` o archivado WAL enviado fuera de la máquina (Cloudflare R2), más una restauración probada a staging cada cierto tiempo;
- firewall que solo abra 80/443 y SSH con clave; Postgres escuchando solo en la red interna;
- actualizaciones de seguridad automáticas del sistema y alertas básicas de disco y memoria;
- la configuración completa en el repositorio (Compose y variables), para poder reconstruir el servidor.

Cuando haya más de un local pago o no quieras hacerte cargo de la base, el paso natural es mover Postgres a un servicio administrado en la misma región; el código no cambia porque solo depende de `DATABASE_URL`.

**Pagar desde Argentina**

- Los proveedores cobran en dólares. Desde enero de 2026 ya no rige el Impuesto PAIS, pero sigue la percepción del 30 % a cuenta de Ganancias y Bienes Personales sobre consumos en dólares con tarjeta, incluidos servicios digitales.
- Se puede evitar el recargo pagando el resumen de la tarjeta con dólares propios, y la percepción puede pedirse de vuelta a ARCA según el caso. Conviene consultarlo con un contador, porque depende de la situación fiscal de cada uno.
- El costo de infraestructura hay que contemplarlo al definir los planes y precios del producto.

**A verificar antes de elegir**

- Precios actuales en las páginas oficiales de cada proveedor.
- Que el proveedor no corte conexiones SSE ociosas antes de 25 s.
- Si se elige un servicio administrado, que permita crear roles propios y que `set_config` por transacción funcione detrás de su pooler.
- Prueba real de latencia desde el local hacia la región elegida.

### Monitoreo

El MVP usa una sola herramienta: **Better Stack, plan gratuito**, que cubre uptime, errores y logs en una sola cuenta.

**Qué se monitorea**

- **Uptime:** un monitor sobre `GET /health`, que hace una consulta simple a la base y responde 200 si todo está bien.
- **Heartbeats:** una señal por cada tarea programada (cierre de caja, backups y cualquier job periódico). Si no llega a tiempo, avisa.
- **Webhook de WhatsApp:** un monitor sobre la ruta pública, porque si cae se pierden pedidos sin que nadie se entere. Como el webhook siempre responde 200, el monitor solo prueba que la ruta esté accesible; que el procesamiento funcione se vigila con un heartbeat de la cola del bot en la fase 2.
- **Errores:** captura de excepciones no controladas y de respuestas 5xx del backend, con `tenant_id`, ruta y `request_id`. Nunca datos personales, contraseñas ni tokens.
- **Logs:** logs estructurados en JSON desde el backend, con `request_id` y `tenant_id`.

**Alertas**

Por email y por Slack o Telegram, según lo que se use. Solo para caídas de `/health`, heartbeats perdidos y errores nuevos o repetidos.

**Decisiones de diseño**

- Se instala el SDK compatible con Sentry (`@sentry/node`) apuntando al DSN de Better Stack. Si más adelante se cambia de proveedor, solo cambia el DSN.
- Todo el envío a Better Stack va detrás de un módulo propio (`monitoring`), igual que email y almacenamiento, para no dispersar llamadas por el código.
- Los errores se agrupan por `tenant_id` como etiqueta, no como dato libre.

**A verificar al contratar**

- Que el plan gratuito, descrito por el proveedor como "para proyectos personales", permita uso comercial con clientes que pagan.
- Los límites vigentes de monitores, excepciones y retención de logs (la página de precios los mezcla entre planes).

## Límites conocidos del MVP

### Sin internet en el local

**Decisión:** el MVP no tiene modo sin conexión. Habría que resolver sin servidor la numeración de pedidos, el stock, la caja y los conflictos al sincronizar: es de las partes más caras de este tipo de sistema, y sin un piloto real no se sabe si hace falta. Las claves de idempotencia y las versiones de las decisiones anteriores dejan la puerta abierta para una cola offline más adelante. Este límite se le avisa al local piloto.

| Componente | Sin internet en el local |
| --- | --- |
| Recepción | No se pueden tomar, cobrar ni consultar pedidos |
| Impresión | Con la página ya cargada se puede imprimir, pero el pedido no se guarda. No se promete como función |
| Repartidor | Si usa datos del celular no se entera de la caída del local. Con mala cobertura, la acción queda en cola con su clave y reintenta sola |
| Bot de WhatsApp | Sigue funcionando en la nube: toma y confirma pedidos que el local no ve ni imprime. Es el riesgo más serio |

**Mitigaciones.**

- **Plan B en papel:** el local ya trabaja con papel y lápiz. Al volver la conexión se cargan los pedidos con su hora real.
- **Carga posterior:** el Recepcionista puede registrar un pedido con la hora en que ocurrió, solo dentro de la sesión de caja abierta y del día comercial en curso; un turno ya cerrado o un día anterior lo carga el Encargado o el Dueño (ver "Carga posterior"). Queda marcado como "cargado después" (`loaded_late`) y auditado, y la fecha comercial se calcula con esa hora. El cierre de caja pide haberlos cargado antes.
- **Conexión de respaldo en el onboarding:** un celular con datos compartidos que la PC de recepción pueda usar, junto con el paso de Chrome en modo kiosco.
- **Detección de local desconectado (fase 2, con el bot):** la pantalla de recepción envía una señal cada pocos segundos. Si el servidor no la recibe por unos minutos con el local abierto, el bot deja de confirmar pedidos nuevos, avisa al cliente que llame por teléfono y notifica al Dueño.
- **Caída de la plataforma:** produce el mismo efecto para el local y se resuelve con el mismo plan B.

## Fuentes consultadas

- [Node.js Releases](https://nodejs.org/en/about/releases/): Node 24 "Krypton" en LTS y Node 26 como versión Current (consultado el 2026-11-21).
- [Express 5.1: ahora por defecto en npm](https://expressjs.com/2025/03/31/v5-1-latest-release): Express 5 es la versión por defecto en npm.
- [Introducción a Express v5](https://expressjs.com/2024/10/15/v5-release): requiere Node 18 o superior.
- [pg-boss](https://github.com/timgit/pg-boss): cola de trabajos sobre PostgreSQL; requiere Node 22.12 o superior y PostgreSQL 13 o superior.
- [Postgres Row-Level Security para SaaS multitenant](https://encore.dev/articles/postgres-row-level-security-multi-tenant): contexto de tenant por transacción y rol que no sea dueño de las tablas.
- [Prisma ORM: introducción](https://www.prisma.io/docs/understand-prisma/prisma-in-your-stack/is-prisma-an-orm): Prisma 7 requiere un adaptador de driver (`@prisma/adapter-pg` para PostgreSQL); Prisma 8 está en release candidate.
- [Prisma 7.9.0](https://sourceforge.net/projects/prisma.mirror/files/7.9.0/): última versión estable de la serie 7 encontrada (julio de 2026).
- [Demostración de RLS con Prisma](https://github.com/realstandal/redwood-rls-demo): `set_config` con valor local dentro de una transacción, y rol sin `BYPASSRLS`.
- [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7?via=prisma7): versiones mínimas de Node.js y TypeScript, y soporte ESM.
- [Generators (Prisma ORM v7)](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators): el generador `prisma-client` y su campo `moduleFormat`.
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html): tipo `application/problem+json`, miembros estándar y extensiones, y el ejemplo de errores de validación (consultado el 2026-11-24).
- [OWASP: Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): `Sec-Fetch-Site` como señal principal, verificación de `Origin` o `Referer` como respaldo, `SameSite` como defensa adicional y CSRF de login (consultado el 2026-11-24).
- [Render: regiones disponibles](https://render.com/docs/regions): Oregon, Ohio, Virginia, Frankfurt y Singapur, sin São Paulo (consultado el 2026-11-24).
- [Fly.io: precios](https://fly.io/pricing.md): máquinas en São Paulo con multiplicador de región, volúmenes y planes de Postgres administrado (consultado el 2026-11-24).
- [Railway: solicitud de región São Paulo](https://station.railway.com/questions/request-access-to-sao-paulo-sa-east1-631aefc2): respuesta de Railway de que São Paulo no está disponible para desplegar (consultado el 2026-11-24).
- [Supabase: precios](https://supabase.com/pricing.md): plan Pro y cómputo; región São Paulo según [getdeploying](https://getdeploying.com/supabase) (consultado el 2026-11-24).
- [Precios de VPS en São Paulo (Valebyte)](https://valebyte.com/es/vps/brazil/?provider=vultr): precios de Vultr en São Paulo según un comparador, sin verificar en el proveedor (consultado el 2026-11-24).
- [SSD Nodes: VPS en Brasil](https://www.ssdnodes.com/learn/vps-hosting-brazil): piso de latencia desde São Paulo (consultado el 2026-11-24).
- [iProfesional: fin del Impuesto PAIS](https://www.iprofesional.com/finanzas/445708-fin-del-impuesto-pais-como-impacta-la-baja-del-30-en-consumos-con-tarjeta-en-el-exterior): vigencia de la percepción del 30 % (consultado el 2026-11-24).
- [Better Stack: precios](https://betterstack.com/pricing.md): plan gratuito con 10 monitores y heartbeats, 100.000 excepciones por mes y captura compatible con el SDK de Sentry (consultado el 2026-11-24).
- [Sentry: precios](https://sentry.io/pricing/): plan Developer gratuito con 5.000 errores por mes, usado como referencia de comparación (consultado el 2026-11-24).
- [Meta: webhooks de WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview): reintentos por hasta 7 días ante cualquier código distinto de 200 (consultado el 2026-11-24).
- [Meta: throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput): 80 mensajes por segundo por número (consultado el 2026-11-24).
- [Meta: envío de mensajes y ventana de servicio](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages): ventana de 24 horas (consultado el 2026-11-24).
- [Hookdeck: webhooks de WhatsApp en producción](https://hookdeck.com/webhooks/whatsapp/guide-duplicates-ordering-retries-timeouts): claves de deduplicación y retención de 7 días (consultado el 2026-11-24).
- [SleekFlow: precios de WhatsApp](https://help.sleekflow.io/en_US/pricing): tarifas por mensaje en Argentina desde el 1 de octubre de 2026, de un revendedor, sin verificar en Meta (consultado el 2026-11-24).
