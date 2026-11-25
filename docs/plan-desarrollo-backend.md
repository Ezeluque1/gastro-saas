# Plan de desarrollo del backend

Sistema de gestión gastronómica (SaaS multitenant). Este plan baja a fases de trabajo lo que ya está definido en el documento del backend y en el del MVP. Si algo de acá contradice esos documentos, mandan los documentos.

## Cómo leer este plan

- **Orden:** cada fase deja algo que se puede probar de punta a punta. No se empieza una fase sin cerrar la anterior.
- **Estimaciones:** son en semanas de trabajo de una sola persona, a ritmo parcial. Son orientativas y se revisan al cerrar cada fase.
- **Definición de "terminado" (vale para todas las fases):**
  - Pruebas de integración contra Postgres real, incluida una prueba de aislamiento entre dos tenants.
  - Cada endpoint respeta las convenciones: errores `application/problem+json`, importes como string, paginación por cursor, `Idempotency-Key` en las escrituras que lo piden.
  - Cada escritura relevante deja registro de auditoría.
  - El contrato (rutas, permisos, códigos de error) coincide con el documento del backend.
- **Stack:** Node 24, TypeScript, Express 5, PostgreSQL 13 o superior, Prisma 7 con `@prisma/adapter-pg`, argon2id, Resend, Cloudflare R2. pg-boss entra recién en la fase 2 del producto.

## Resumen

| Fase | Objetivo | Resultado que se puede probar | Estimación |
|---|---|---|---|
| 0 | Base del proyecto | Servidor que levanta, se conecta a Postgres y corre pruebas en CI | 1 semana |
| 1 | Multitenancy y autenticación | Alta de un local por script, login y sesión por local, aislamiento comprobado | 2 a 3 semanas |
| 2 | Usuarios, roles y permisos | El Dueño crea usuarios y roles, y los permisos se hacen cumplir | 2 semanas |
| 3 | Catálogo y precios | Categorías, productos, variantes, extras y precios con historial | 2 semanas |
| 4 | Stock e insumos | Stock con libro de movimientos y carga por código de barras | 2 semanas |
| 5 | Clientes y pedidos | Un pedido completo de punta a punta, con estados y numeración | 3 a 4 semanas |
| 6 | Caja y delivery | Turnos de caja, salidas de repartidores y rendición | 3 semanas |
| 7 | Reportes, auditoría y exportación | Reportes en pantalla, cierre de caja, historial de auditoría y CSV | 2 semanas |
| 8 | Plataforma, soporte y operación | Panel de plataforma, modo soporte, monitoreo, backups y despliegue | 2 semanas |
| 9 | Endurecimiento y piloto | Revisión de seguridad, carga de prueba y puesta en marcha en el local piloto | 2 semanas |
| 10 | Fase 2 del producto | Bot de WhatsApp, catálogo web y el resto de lo diferido | A definir |

Total del MVP (fases 0 a 9): unas 21 a 24 semanas.

---

## Fase 0. Base del proyecto

**Objetivo:** tener el esqueleto sobre el que se apoya todo lo demás, antes de escribir una sola regla de negocio.

**Tareas**
- Repositorio, estructura de carpetas por módulos (monolito modular) y reglas de dependencia entre capas.
- TypeScript estricto, ESLint, formato y scripts de desarrollo, prueba y compilación.
- Configuración por variables de entorno, validada al arrancar (falla si falta algo).
- Express 5 con el pipeline base: `request_id`, logs estructurados en JSON, manejo central de errores en `application/problem+json`, límites de cuerpo y de tasa.
- Conexión a Postgres con Prisma y una carpeta de migraciones. Contenedor de Postgres para desarrollo y pruebas.
- Endpoint `GET /health`, fuera del versionado.
- Pruebas: Vitest o similar, con base real en contenedor, y un comando que levanta todo.
- Integración continua: instalar, compilar, correr pruebas y linter en cada cambio.
- Módulo `monitoring` mínimo (envoltorio de captura de errores) apuntando a Better Stack, para que los errores se vean desde el día uno.

**Entregable:** el servidor responde `/health`, las pruebas corren en CI y un error forzado aparece en Better Stack.

**Riesgos**
- Prisma 7 con el adaptador es nuevo: si da fricción seria, el plan B documentado es Prisma 6.
- ESM con Node 24: definir temprano la configuración de `tsconfig` y de ejecución en desarrollo.

---

## Fase 1. Multitenancy y autenticación

**Objetivo:** que el aislamiento entre locales funcione antes de que existan datos de negocio.

**Tareas**
- Tablas base: `tenants`, `plans`, `tenant_settings`, `users`, `user_sessions`, `audit_log`.
- Row Level Security: `withTenant()` que abre una transacción y fija `app.tenant_id` con `set_config(..., true)`. Rol de aplicación sin `BYPASSRLS`.
- Las tres funciones `SECURITY DEFINER`: `resolve_tenant_by_slug`, `resolve_tenant_by_wa_phone` y `create_tenant`, cada una con su registro de uso.
- Script de alta de local (`create_tenant`): una sola transacción, idempotente. Crea tenant, primera sucursal y su caja, roles base desde la plantilla, primer Dueño con link de activación de un solo uso, configuración por defecto (incluidos los dos topes de egreso, que se piden en este paso y quedan en 0 si no se cargan) y plan.
- Rutas bajo `app.<dominio>/l/{slug}/api/v1`. Verificación de que el local de la sesión coincida con el slug (403 `permission_denied` con `tenant_mismatch`).
- Login con argon2id, mismo error para local inexistente, usuario inexistente y clave incorrecta. Límite de intentos.
- Sesiones del lado del servidor: token opaco guardado como hash, cookie `HttpOnly; Secure; SameSite=Strict; Path=/l/{slug}`. Sesión larga para el repartidor.
- Protección CSRF con `Sec-Fetch-Site` como señal y `SameSite` como defensa en profundidad.
- Activación de cuenta por link, cambio de clave y clave temporal con `must_change_password`.
- Recuperación de clave por email (Resend) para Dueños con email verificado.
- Estados del local: `pilot`, `active`, `past_due`, `suspended`, `cancelled`, y el middleware que bloquea escrituras con 403 `tenant_suspended`.

**Entregable:** se da de alta un local de prueba con el script, el Dueño activa su cuenta, inicia sesión y consulta `/me`. Una prueba automática demuestra que un usuario del local A no ve nada del local B ni siquiera con un bug de filtro.

**Riesgos**
- RLS mal configurado es el error más caro de todo el proyecto: dedicar tiempo a las pruebas de aislamiento y no seguir hasta que pasen.
- Pool de conexiones y `set_config` transaccional: asegurar que nunca se filtre un `tenant_id` entre peticiones.

---

## Fase 2. Usuarios, roles y permisos

**Objetivo:** que cada acción posterior se pueda proteger con un permiso desde el inicio.

**Tareas**
- Catálogo de permisos fijo en código y plantilla de roles versionada (Dueño, Encargado, Recepcionista/Cajero, Delivery). Cocina queda fuera.
- Tablas `roles`, `role_permissions`, `user_branch_roles`. Un usuario tiene un rol por sucursal o el mismo en todas.
- Función `puede(usuario, permiso, sucursal)` y middleware que la aplica. Migración que suma permisos nuevos a los roles que correspondan.
- Permisos con tope (`tenant_settings`): tope de descuento (10% inicial), tope por egreso y tope acumulado por turno. Ningún monto en pesos tiene valor por defecto.
- Endpoints de usuarios y roles: alta, edición, baja lógica, asignación por sucursal, restablecimiento de clave (Encargado para Recepcionista y Delivery, Dueño para todos).
- Reglas de seguridad: el Dueño no se puede quedar sin Dueño (`last_owner`), roles del sistema protegidos, límite de sucursales según el plan.
- Sucursales: alta, edición y horarios. Configuración del local para el frontend (`GET` de ajustes sin credenciales).
- Control de ediciones simultáneas con la columna `version`.

**Entregable:** el Dueño crea un Encargado y un Recepcionista, y las pruebas demuestran que cada rol solo hace lo que le corresponde, incluido `403 permission_denied` con el permiso faltante.

---

## Fase 3. Catálogo y precios

**Objetivo:** tener el catálogo que después consumen los pedidos.

**Tareas**
- Categorías, productos y variantes (todo producto tiene al menos una). El precio vive en la variante. Costo manual opcional y control de stock opcional por variante.
- Extras con precio fijo, asociados a productos o categorías.
- Importes: `numeric(14,2)` en la base, string con dos decimales en la API. Una sola regla de redondeo en el servidor.
- Actualización de precios: ajuste porcentual general, por categoría o individual, que alcanza también a los extras. Historial de precios por cada cambio.
- Imágenes de producto: `media_assets` con URLs firmadas contra Cloudflare R2, tamaños y tipos validados.
- Búsqueda `q` con columna normalizada (`name_search`), sin depender de extensiones de Postgres.
- Script de importación del catálogo inicial desde planilla (parte del onboarding acompañado).

**Entregable:** cargar un catálogo real de rotisería por importación, editarlo y subir un precio un 10% con historial.

---

## Fase 4. Stock e insumos

**Objetivo:** control de stock por sucursal, sin recetas.

**Tareas**
- Insumos con unidad, stock mínimo y costo opcional.
- Libro de movimientos (`stock_movements`): compra, producción, venta, ajuste, merma y devolución, con usuario y motivo. Es la única forma de cambiar el stock.
- Stock de productos terminados por variante, con control activable.
- Códigos de barras: varios por insumo, con presentación y unidades por escaneo. Código único por tenant y dígito verificador validado.
- Alta rápida por código desconocido, con sugerencia de insumos de nombre parecido.
- Configuración: stock insuficiente solo advierte o bloquea (`insufficient_stock`, 409).
- Alertas de stock mínimo.
- Conteos y ajustes.

**Entregable:** escanear un código nuevo, darlo de alta, registrar una compra y ver el libro de movimientos coherente con el stock.

---

## Fase 5. Clientes y pedidos

**Objetivo:** el corazón del sistema. Es la fase más grande y la que más conviene partir en entregas chicas.

**Tareas**
- Clientes: búsqueda por teléfono (columna con solo dígitos), alta rápida, direcciones.
- Pedidos: mostrador, retiro y delivery. Ítems, extras, notas por ítem, nota general e ítem libre. Precio y nombre congelados al momento de la venta.
- Numeración: `order_counters` por sucursal y fecha comercial, dentro de la transacción del pedido.
- Fecha comercial con horario de corte configurable y zona horaria del local.
- Todo en una sola transacción: pedido, ítems, extras, movimientos de stock, pago y movimiento de caja.
- Idempotencia: `Idempotency-Key` con tabla `idempotency_keys`, orden de chequeos correcto y `client_request_id` único por tenant.
- Máquina de estados: Recibido, En preparación, Listo, En camino, Entregado, No entregado, Cancelado. Transiciones condicionales (`UPDATE ... WHERE estado = ...`), 422 `invalid_transition` con `from` y `to`, y gana el primero en doble marcado.
- Historial de estados (`order_status_history`) con usuario, hora, origen, motivo e intento.
- Edición hasta En preparación, con control de versión y reimpresión marcada como MODIFICADO.
- Descuentos manuales con tope por pedido sobre el total, motivo obligatorio y aprobación por encima del tope (`orders.discount_over_limit`).
- Cancelaciones: Recepción en Recibido o En preparación, Encargado después. Devolución de stock.
- "No entregado": solo desde Listo o En camino, motivo de lista corta, registro en `delivery_attempts`, reversión con `orders.revert_undelivered`.
- Carga posterior tras caída de conexión: `loaded_late`, hora real y hora de carga, número nuevo del contador, límite de Recepción al turno abierto y `orders.backdate_any` para el resto.
- Pago pendiente al entregar: avisa o bloquea según configuración.
- SSE para la pantalla de recepción.
- Datos para impresión (comanda, ticket y precuenta) y reimpresión.

**Entregable:** tomar un pedido de delivery con extras y descuento, pasarlo por todos los estados, cancelar otro y revertir un "No entregado", con el stock y el historial correctos.

**Riesgos**
- Concurrencia en numeración, stock y estados: cubrir con pruebas que disparen peticiones en paralelo.
- Cuidar que la fase no se estire: entregar primero mostrador y retiro, y después delivery.

---

## Fase 6. Caja y delivery

**Objetivo:** el dinero y los repartidores, que son lo más sensible para el dueño.

**Tareas**
- Sesiones de caja: una sola abierta por caja, apertura con efectivo contado y diferencia contra el cierre anterior, arqueo parcial, cierre inmutable.
- Movimientos: cobros por medio de pago, ingresos y egresos manuales con categoría, concepto obligatorio, comprobante opcional y adjunto.
- Topes de egreso: por egreso y acumulado por turno, con aprobación (`cash.movements_over_limit`). Con tope 0, todo egreso requiere aprobación. Retiro del dueño con `cash.owner_withdrawal`.
- Efectivo esperado, sobrante y faltante, y resumen de cierre.
- Reapertura de caja solo del Dueño, auditada. Ajustes por movimiento en la sesión siguiente.
- Salidas de repartidores (`delivery_runs`): asignar varios pedidos a la vez y pasarlos a En camino. El reintento de un "No entregado" entra por una nueva salida.
- API del repartidor: ver sus pedidos, confirmar entrega, registrar "No entregado". Cola de reintento en el cliente con `occurred_at` informativo.
- Rendición: lo que debería entregar, lo que se recibió, diferencia registrada por repartidor y turno. El efectivo sigue "a rendir" hasta rendirse.
- Advertencia o bloqueo al cerrar con pagos pendientes o repartidores sin rendir.

**Entregable:** un turno completo: abrir caja, cobrar, registrar un egreso con tope, despachar dos repartidores, rendir con una diferencia y cerrar con el resumen correcto.

---

## Fase 7. Reportes, auditoría y exportación

**Objetivo:** que el dueño vea qué pasó y por qué.

**Tareas**
- Reportes descriptivos en SQL con `businessDateFrom` y `businessDateTo`: ventas por canal y medio de pago, ticket promedio, cancelaciones, descuentos, extras vendidos, pérdidas por no entregados, diferencias de rendición, margen con costo manual.
- Control por usuario y período: cancelaciones, descuentos aprobados, egresos y pedidos cargados después. Registro del tope vigente en cada descuento y egreso aprobado.
- Entregas marcadas por recepción, para detectar abusos junto con las diferencias de rendición.
- Historial de auditoría consultable por el Dueño.
- Exportaciones a CSV (permiso propio, con límites).
- Resumen de cierre de caja.

**Entregable:** los reportes cuadran con los datos de prueba de las fases 5 y 6, y una exportación abre bien en una planilla.

---

## Fase 8. Plataforma, soporte y operación

**Objetivo:** poder operar el sistema sin tocar la base a mano.

**Tareas**
- Panel de plataforma en `admin.<dominio>/api/v1`, con tabla, sesión y cookie propias, y `platform_audit_log`.
- Gestión de locales: listado, cambio de estado (suspender, mora, cancelar), plan y sucursales.
- Modo soporte de solo lectura: `support_sessions`, código de un solo uso de unos 60 segundos, `GET` de confirmación sin efectos y `POST` de canje con verificación de `Origin`, sesión `kind = 'support'` sin `user_id`, cookie `__Secure-support_sid`, 30 minutos fijos, lista explícita de rutas `GET` permitidas, exportaciones prohibidas (403 `support_mode_forbidden`), una sesión activa por administrador (409 `support_session_active`) y 422 `support_code_invalid`. Pantalla "Accesos de soporte" para el Dueño.
- Monitoreo con Better Stack: uptime de `/health`, heartbeats de tareas programadas, monitor del webhook, captura de errores etiquetados por `tenant_id`, alertas solo por caída, heartbeat perdido y errores nuevos o repetidos.
- Backups diarios a R2 con restauración probada.
- Despliegue: entorno de producción según la decisión de hosting (provisoriamente un VPS en São Paulo con Docker Compose, Postgres y Caddy), migraciones automáticas controladas y variables de entorno separadas por entorno.

**Entregable:** el administrador abre una sesión de soporte, el Dueño la ve registrada, un backup se restaura en una base limpia y una caída simulada dispara la alerta.

**Decisión pendiente:** el hosting definitivo se decide en esta fase, no antes. La aplicación depende solo de `DATABASE_URL`.

---

## Fase 9. Endurecimiento y piloto

**Objetivo:** llegar al local piloto con confianza.

**Tareas**
- Revisión de seguridad: cabeceras, límites de tasa, validación de entradas, manejo de secretos, revisión de todas las rutas contra el catálogo de permisos y contra RLS.
- Prueba de carga razonable para un local (picos de almuerzo y cena) y revisión de índices con `EXPLAIN` en las consultas calientes.
- Revisión de la documentación de la API contra lo implementado.
- Datos de demostración y guion de pruebas con el flujo real del local piloto.
- Onboarding: carga del catálogo, alta de usuarios, cargado de los topes en pesos, configuración de Chrome en modo kiosco para la impresión y capacitación.
- Plan de contingencia: qué pasa si se cae la conexión, cómo cargar pedidos después, a quién avisar.
- Revisar con un contador el pago de servicios en dólares desde Argentina y la tarifa de Meta para Argentina, antes de poner precio al plan.

**Entregable:** el local piloto opera un día completo con el sistema, con acompañamiento.

---

## Fase 10. Fase 2 del producto (después del piloto)

Se planifica en detalle con lo que enseñe el piloto. Lo ya definido:

- **Bot de WhatsApp:** `POST /webhooks/whatsapp` guarda el payload crudo en `whatsapp_inbox` y responde exactamente 200. Un job de pg-boss lo procesa, con deduplicación por `messages[].id` y por `statuses[].id` más el estado. Salida por `whatsapp_outbox`, un job activo por conversación, al menos 6 segundos entre mensajes al mismo cliente. Ventana de 24 horas con `conversations.window_expires_at` y mensajes bloqueados cuando está cerrada (422 `whatsapp_window_closed`).
- **Bandeja de WhatsApp** con toma y devolución de conversaciones, y resolución de mensajes bloqueados.
- **IA del bot:** pendiente de definir (proveedor, funciones, validación, comportamiento ante fallas, datos enviados y costo por local).
- **Plantillas de utilidad:** confirmación de pedido programado, estado del pedido y aviso de no entregado.
- **Cuenta de WhatsApp por local:** alta manual, con el pago directo a Meta y alerta al Dueño al acercarse a 1.000 mensajes.
- Catálogo web público, pantalla de cocina, web de consulta del pedido, zonas de delivery por distancia, link o QR de Mercado Pago, seguimiento de diferencias y mejoras de extras.
- Aviso por email al Dueño de los accesos de soporte.
- Fase 3 del producto: reportes que ayudan a decidir y facturación ARCA mediante un proveedor.

---

## Decisiones y verificaciones que siguen abiertas

- **Hosting definitivo:** se decide en la fase 8.
- **IA del bot:** se define antes de empezar el bot, en la fase 10.
- **Tarifa de Meta para Argentina:** el valor que se manejó viene de un revendedor. Verificarlo antes de dar números a un local.
- **Precios de email (Resend) y de R2:** verificar contra las páginas oficiales antes de fijar el precio del plan.
- **Better Stack:** confirmar que el plan gratuito admite uso comercial y sus límites actuales.
- **Prisma:** evaluar partir el esquema por módulo si el archivo crece.
- **Transacciones de solo lectura** para las sesiones de soporte: sugerido, falta decidir.
- **Permiso para corregir un "Entregado" por error:** hoy lo hacen Encargado y Dueño por rol. Decidir si merece un permiso propio.
- **Ruta de la reversión de "No entregado":** `POST /orders/{id}/revert-not-delivered` es un nombre de trabajo.

## Cómo trabajar cada fase

1. Releer la sección del documento del backend que corresponde y listar las tablas, endpoints, permisos y códigos de error de la fase.
2. Escribir primero la migración y las pruebas de aislamiento entre tenants.
3. Implementar por módulo, de adentro hacia afuera: repositorio, servicio, rutas.
4. Probar a mano con el frontend o con un cliente HTTP y cerrar con las pruebas de integración.
5. Actualizar los documentos si algo cambió durante la implementación. Los documentos y el código tienen que coincidir.
