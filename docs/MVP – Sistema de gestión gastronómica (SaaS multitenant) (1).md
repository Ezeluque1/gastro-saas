# MVP – Sistema de gestión gastronómica (SaaS multitenant)

Nov 17, 2026 · @Ezequiel Luque

## Visión y diferencial

SaaS multitenant para gestionar rotiserías y locales de comida rápida con mostrador en Argentina: cada negocio (tenant) puede tener varias sucursales y todo funciona desde el navegador.

- **Cliente objetivo del MVP:** rotiserías y fast food con venta por mostrador, retiro y delivery. Sin mesas ni mozos en esta versión.
- **Diferencial:** competir por funcionalidades generales contra Fudo, Pedix o Pedisy es difícil. La propuesta es competir por cercanía: disponibilidad ante cualquier inconveniente, capacitación y onboarding acompañado, con la carga inicial del catálogo incluida.
- **Diferencial técnico:** un bot de WhatsApp que toma pedidos y pasa la conversación a una persona cuando hace falta.

## Alcance por fases

El MVP piloto cubre la operación diaria de un local; el canal digital y la inteligencia de datos vienen después, pero el modelo de datos se diseña desde el inicio para todo.

| Fase | Contenido |
| --- | --- |
| 1. MVP piloto | Tenant y sucursales, usuarios y roles, productos con variantes, extras con precio, precios, stock de productos e insumos (con código de barras), pedidos con estados (mostrador, retiro, delivery), caja y rendición de repartidores, interfaz web del repartidor, impresión de comanda y precuenta, configuración del tenant, exportación de datos a CSV, historial de auditoría y modo soporte de solo lectura |
| 2. Canal digital | Catálogo web generado desde los productos, bot de WhatsApp híbrido con traspaso a humano, promociones temporales, pantalla para cocina, web de consulta del pedido, link o QR de Mercado Pago, zonas de delivery por distancia, seguimiento de diferencias y tolerancia configurable en la rendición, y mejoras de los extras (precio por tamaño, sustituciones, precios negativos, límites de selección, descuento de stock) |
| 3. Inteligencia y fiscal | Reportes que ayudan a decidir (no solo a mostrar), facturación ARCA mediante un proveedor intermediario |

## Roles y permisos

Los permisos son configurables por el tenant y se asignan por rol y por sucursal, no están fijos en el código.

| Rol inicial | Qué hace |
| --- | --- |
| Dueño | Acceso total, configuración, usuarios, precios, reapertura de caja e historial de accesos de soporte a su local |
| Encargado | Gestión de la sucursal: stock, caja, reportes y cancelaciones tardías. Revierte pedidos no entregados, restablece las claves de Recepcionista y Delivery, y puede cargar pedidos de un turno ya cerrado |
| Recepcionista / Cajero | Toma pedidos, cobra, imprime, atiende la bandeja de WhatsApp, asigna y rinde repartidores y cambia los estados del pedido. También marca "Entregado" (retiro por mostrador, o delivery si el repartidor no puede) y "No entregado" con motivo, cancela pedidos en Recibido o En preparación, y aplica descuentos y registra egresos dentro de los topes que define el Dueño |
| Cocina | No usa el sistema en el MVP: se entera por la comanda impresa y avisa al recepcionista cuando termina (pantalla de cocina en fase 2) |
| Delivery | Tiene su propia interfaz web, donde ve los pedidos que le asignaron, confirma la entrega o la marca como no entregada con su motivo. Rinde su efectivo al recepcionista |

- **Catálogo de permisos:** fijo en el código (por ejemplo `orders.create`, `orders.discount`, `prices.edit`, `cash.open`, `cash.close`, `supplies.create`).
- **Roles:** se crean al dar de alta el tenant y el Dueño puede editarlos o crear otros.
- **Asignación:** un usuario tiene un rol por sucursal, o el mismo rol en todas.

## Catálogo, variantes y precios

Todo producto tiene al menos una variante (Individual, Grande, Docena; o "Único" si no hay más), y el precio vive en la variante.

- **Estructura:** categorías → productos → variantes. Cada variante tiene precio, costo manual opcional y control de stock opcional. Productos y variantes no cargan ingredientes ni composición, porque el MVP no maneja recetas.
- **Pedidos especiales sin costo:** cada ítem del pedido admite una nota libre (por ejemplo "sin orégano") que sale destacada en la comanda. El pedido también tiene una nota general. La puede escribir el recepcionista o el cliente.
- **Ítem libre:** el recepcionista puede agregar una línea con nombre y precio a mano para lo que no está en el catálogo.
- **Precio único:** en el MVP el precio es el mismo en todas las sucursales y canales.
- **Actualización de precios:** ajuste porcentual general (el mismo porcentaje para todo), por categoría o individual, y alcanza también a los extras. Cada cambio queda en un historial de precios. La programación por fecha queda fuera del MVP.

### Extras con precio

Los extras con precio entran al MVP, con un precio fijo definido por cada tenant. Se descartó el recargo en porcentaje sobre el pedido.

- El tenant crea sus extras de forma independiente, cada uno con nombre y precio (por ejemplo Huevo $800, Queso $600).
- Cada extra se asocia a los productos o categorías donde se puede ofrecer.
- El cliente (catálogo o bot) o el recepcionista agrega el extra a un ítem concreto del pedido.
- El precio del extra se suma al ítem, y el total del pedido es la suma de los ítems con sus extras.
- El pedido guarda el precio del extra al momento de la venta, así que un cambio posterior no afecta pedidos anteriores.
- El extra aparece como línea propia en la comanda, el ticket y los reportes.
- Por defecto el extra no descuenta stock.
- Un extra con precio es distinto de un pedido especial sin costo ("sin orégano"), que sigue siendo una nota en la comanda.

**Por qué precio fijo y no porcentaje:** el costo real de un extra no depende del precio del plato; con varios ítems no queda claro sobre qué base se aplicaría el porcentaje; y un precio fijo se muestra claro al cliente y al bot antes de confirmar, y es más simple para ARCA y los reportes.

**A validar en el piloto:** qué extras se cobran hoy, con qué frecuencia y si el precio varía según el producto o el tamaño. Si varía mucho, el precio por tamaño pasa de la fase 2 al MVP.

## Stock e insumos

El stock se lleva por sucursal para dos tipos de ítem, sin recetas: el sistema no descuenta insumos por cada venta.

- **Productos terminados:** stock por variante, con control activable (en lo elaborado en el día suele tener sentido solo en lo que se agota, como las docenas de empanadas).
- **Insumos (materia prima):** nombre, unidad, stock mínimo y costo opcional. Se actualizan por compras, ajustes, mermas y conteos.
- **Libro de movimientos:** toda variación queda registrada (compra, producción, venta, ajuste, merma, devolución) con usuario y motivo. Es la base de los reportes de rotación.
- **Stock insuficiente:** una configuración del tenant decide si solo advierte o bloquea la venta.
- **Consecuencia de no usar recetas:** el sistema no calcula el costo real de cada producto. Para ver márgenes se usa el costo manual opcional de cada variante.

### Carga de stock con código de barras

- Cada insumo puede tener varios códigos (marcas y presentaciones distintas). Cada código guarda su presentación (por ejemplo "Caja x12") y cuántas unidades suma por escaneo.
- Las variantes de productos comprados (gaseosas) también pueden tener código de barras.
- **Código conocido:** el sistema muestra el insumo y la cantidad sugerida, y la persona confirma o ajusta.
- **Código desconocido:** se abre un alta rápida con el código ya cargado. Se puede asociar a un insumo existente o crear uno nuevo, y el código queda registrado para la próxima vez. Antes de crear uno nuevo se sugieren insumos de nombre parecido.
- **Permiso propio** (`supplies.create`) para el alta rápida. Un código no puede repetirse en el mismo tenant, y uno mal asociado se reasigna o desactiva sin perder el historial.
- Los insumos sin código (carne, verdura a granel) se buscan por nombre.
- Un lector USB funciona como teclado, así que alcanza con un campo de texto. El código se guarda como texto y se valida su dígito verificador.

## Pedidos

El recepcionista toma el pedido en siete pasos, y los pedidos del bot o del catálogo terminan en el mismo flujo.

1. **Tipo y canal:** mostrador, retiro o delivery. El canal queda registrado (mostrador, teléfono, Instagram, WhatsApp, catálogo). El recepcionista carga los pedidos de mostrador, teléfono e Instagram, y el bot toma los de WhatsApp.
2. **Cliente:** búsqueda por teléfono, con alta rápida si no existe. En mostrador es opcional.
3. **Ítems y extras:** categoría o búsqueda → producto → variante → cantidad → extras → nota. También ítem libre, o escaneo de código para productos comprados.
4. **Descuentos:** las promociones vigentes se aplican solas cuando existan (fase 2). Un descuento manual requiere el permiso `orders.discount`.
5. **Delivery:** se suma el monto fijo de envío que define el tenant, como línea aparte. El repartidor se asigna después.
6. **Cobro:** el sistema registra el medio y el estado de pago, sin procesar pagos. Con la caja cerrada no se puede cobrar, pero el pedido se puede crear como pendiente de pago.
7. **Recibir:** se asigna el número, se descuenta el stock de las variantes controladas y el pedido queda en "Recibido". Al enviar la comanda a cocina pasa a "En preparación".

&#91;embedded content: estados del pedido · 7 estados, 2 caminos\]

El recepcionista cambia los estados. "Entregado" y "No entregado" los registra normalmente el repartidor desde su interfaz web, y recepción también puede marcarlos. "No entregado" solo se marca desde "Listo" o "En camino", con motivo obligatorio; un pedido que todavía se prepara se cancela. Deshacer un "No entregado" lo hace quien tenga el permiso de reversión (por defecto, Encargado y Dueño). La cocina no usa el sistema en el MVP y le avisa al recepcionista cuando termina. Un pedido de delivery que no se entrega pasa a "No entregado" y se reintenta al menos una vez.

### Reglas

- **Todo en una transacción:** pedido, ítems, extras, movimientos de stock, pago y movimiento de caja se guardan juntos o no se guarda nada.
- **Número de pedido:** un contador por sucursal y por día, para que dos recepcionistas nunca reciban el mismo.
- **Precio congelado:** cada ítem y cada extra guarda su nombre y precio al momento de la venta.
- **Estados:** los cambia el recepcionista. "Entregado" y "No entregado" los registra el repartidor desde su interfaz web, y recepción también puede marcarlos; si los dos lo hacen casi a la vez, gana el primero. "No entregado" solo desde "Listo" o "En camino". Deshacer un "No entregado" lo hace quien tenga el permiso de reversión (por defecto, Encargado y Dueño), con motivo y auditoría; Recepción puede marcarlo pero no deshacerlo. "Listo" significa cocinado y empaquetado, y se marca cuando la cocina avisa que terminó. El retiro por mostrador va de "Listo" a "Entregado", sin "En camino".
- **Edición:** permitida hasta "En preparación". Si la comanda ya salió, se reimprime marcada como MODIFICADO y el cambio queda en la auditoría.
- **Cancelado y No entregado:** requieren permiso y un motivo obligatorio. "No entregado" se elige de una lista corta (el cliente no retiró, no atendió, dirección incorrecta, otro) y solo desde "Listo" o "En camino"; el pago pendiente no lo afecta, y lo revierte quien tenga el permiso de reversión (por defecto, Encargado y Dueño). Recepción cancela en Recibido o En preparación; después, la cancelación la hace el Encargado. Cada cambio de estado queda con usuario, hora y origen (app del repartidor o recepción), lo que da los tiempos reales de preparación y entrega.
- **Precio del delivery:** monto fijo por envío definido por el tenant, sin importar tamaño ni distancia (Villa del Rosario es chica). Zonas y montos por distancia quedan para la fase 2.
- **Seguimiento por el cliente:** los pedidos de WhatsApp reciben avisos del bot; los demás consultan por el medio en que pidieron. La web de consulta con código no adivinable queda para la fase 2.

* **Día comercial:** arranca en un horario de corte configurable por tenant (por ejemplo 05:00). Un pedido a la 01:30 del sábado pertenece al viernes.
* **Carga posterior:** si una caída de conexión obliga a anotar en papel, el pedido se carga después, con motivo. Queda marcado como "cargado después", con el usuario y las dos horas (la real y la de carga), recibe un número nuevo del contador del día y tiene un campo opcional para el número de la comanda en papel. Recepción solo carga dentro del turno de caja abierto; un turno ya cerrado o un día anterior lo carga el Encargado o el Dueño.
* **Pago pendiente al entregar:** el sistema avisa pero no bloquea la entrega; cada tenant puede configurarlo para que bloquee.
* **Topes de Recepción:** el descuento manual tiene un tope porcentual por pedido, sobre el total, con valor inicial de 10% (el Dueño puede cambiarlo, incluso a 0%) y motivo obligatorio. Los egresos tienen un tope por egreso y un tope acumulado por turno de caja, para que no se parta un pago grande en varios chicos; ambos montos se cargan en el alta del local, sin valor por defecto, porque con la inflación cualquier número en pesos queda viejo. En el onboarding se sugiere un monto de arranque (por ejemplo $50.000), marcado como ejemplo y a validar con el local piloto. Si no se cargan, el tope queda en 0 y todo egreso requiere aprobación. Lo que supera un tope lo aprueba el Encargado o el Dueño.

### Cliente ausente o pedido cancelado

- **Cancelado antes de que salga:** no se cobra y el stock vuelve.
- **No entregado:** se reintenta al menos una vez. El sistema registra los intentos y el motivo de cada uno.
- **Si no se logra entregar:** se intenta reutilizar el producto lo antes posible, y si no se puede se marca como pérdida, para reflejar la merma en el stock y en los reportes.
- **Ya pagado por transferencia:** el sistema lo registra y el reembolso lo hace el local por fuera.

## Caja y delivery

La caja trabaja por sesiones (turnos): una sola sesión abierta por caja, y se admiten varios turnos al día.

### Apertura

- Un usuario con permiso `cash.open` cuenta el efectivo inicial. El sistema sugiere el monto contado en el cierre anterior y registra la diferencia si no coincide.
- Sin sesión abierta no se puede cobrar.

### Durante el turno

- **Cobros de pedidos:** solo el efectivo suma al efectivo esperado. Tarjeta, transferencia y billetera se registran aparte para conciliar. El efectivo del delivery entra por la rendición del repartidor.
- **Ingresos y egresos manuales:** con categoría (gasto menor, retiro del dueño, fondo de cambio, pago a proveedor), concepto obligatorio y comprobante opcional.
- **Cancelaciones:** un pedido cancelado antes de que salga no se cobra. Si ya estaba pagado por transferencia, el sistema lo registra y el reembolso lo hace el local por fuera.
- **Arqueo parcial:** se puede contar la caja sin cerrarla.

### Cierre

- **Efectivo esperado:** apertura + cobros en efectivo en el local + ingresos − egresos + efectivo recibido en las rendiciones de repartidores.
- La persona ingresa el efectivo contado y el sistema calcula el sobrante o faltante, que queda registrado. La tolerancia configurable queda para la fase 2.
- Antes de cerrar avisa de pedidos con pago pendiente y repartidores sin rendir (advertencia o bloqueo, según configuración).
- La sesión queda cerrada e inmutable y se imprime un resumen: ventas por canal y medio de pago, descuentos, cancelaciones, ticket promedio y diferencia.
- Los errores se corrigen con un movimiento de ajuste en la sesión siguiente, o con una reapertura que solo puede hacer el Dueño y que queda auditada.

### Efectivo del delivery y rendición

En delivery con pago en efectivo, el repartidor siempre cobra al entregar. El sistema no procesa pagos: registra el medio y el estado de pago.

**Salida del repartidor:** el recepcionista asigna varios pedidos de una vez a un repartidor y los pasa a "En camino". Esa asignación reemplaza el registro en papel y lápiz de hoy, y de ahí sale la rendición.

**Transferencia:** el cliente envía el comprobante por el mismo medio en que pidió y el recepcionista marca el pedido como pagado.

**Rendición, paso a paso:**

1. Al tomar el pedido, el recepcionista anota con cuánto va a pagar el cliente, para calcular el vuelto.
2. El repartidor confirma cada entrega desde su interfaz web y el pedido pasa a "Entregado". Cada pedido en efectivo entregado queda "a rendir" a nombre del repartidor.
3. Al final del turno, el sistema calcula lo que el repartidor debería entregar (pedidos en efectivo entregados, con el envío incluido) y el recepcionista registra lo que recibió.
4. La caja suma lo realmente recibido, como ingreso en la sesión abierta. El arqueo excluye el efectivo que sigue sin rendir.
5. Cualquier diferencia (faltante o sobrante) solo se registra, con el repartidor, el turno y el monto. No tiene estados ni seguimiento, y cómo se resuelve lo decide el dueño por fuera del sistema. Los reportes muestran las diferencias por repartidor y por período.

**Fase 2:** link o QR de Mercado Pago, seguimiento de diferencias, tolerancia configurable y lo que cobra el repartidor (salvo que el piloto lo pida antes).

**Fuera del alcance del MVP:** sueldo o comisión del repartidor, y posnet con el repartidor.

## Impresión

La impresión se hace desde el navegador, en formato de ticket, sin programa local.

- **Pedido tomado por el bot:** se imprime la comanda automáticamente (el tenant puede desactivarlo). Desde la pantalla de recepción queda disponible el botón para imprimir la precuenta.
- **Pedido tomado manualmente:** la recepcionista elige qué imprimir: comanda, precuenta, ambas o ninguna.
- **La comanda impresa es el aviso a cocina:** la cocina no usa el sistema en el MVP, así que se entera del pedido por la comanda y le avisa al recepcionista cuando termina.
- **Extras:** salen como línea propia en la comanda y en el ticket.
- **Pedido modificado:** la comanda se reimprime marcada como MODIFICADO.
- **Limitación a tener en cuenta:** el navegador abre el diálogo de impresión cada vez. Para que la comanda del bot salga sola, la computadora de recepción necesita Chrome configurado con impresión en modo kiosco (`--kiosk-printing`). Es un paso del onboarding de cada local.

## Catálogo web y bot de WhatsApp

El catálogo web se genera con los productos del tenant para que el cliente elija y después hable con el bot. El bot es híbrido: la IA interpreta el texto libre y un flujo estructurado confirma el pedido. Corresponde a la fase 2.

### Flujo del bot

1. **Mensaje entrante:** el sistema identifica tenant y sucursal por el número que lo recibió, busca o crea al cliente por teléfono y abre o continúa la conversación.
2. **Saludo y horario:** si el local está cerrado lo informa; si está abierto ofrece el catálogo o tomar el pedido por chat.
3. **Toma del pedido:** producto, variante, cantidad y nota; luego retiro o delivery, dirección y zona, y medio de pago. Termina con un resumen que el cliente debe confirmar explícitamente.
4. **Creación:** el pedido se crea con canal "bot". Si tiene una nota especial o el bot tuvo dudas, queda "requiere revisión" para que recepción lo confirme. Si no, se confirma solo (configurable por el tenant).
5. **Avisos al cliente:** el bot confirma el pedido y avisa cuando está listo o en camino con mensajes libres, porque WhatsApp los permite solo dentro de las 24 horas posteriores al último mensaje del cliente. Con la ventana cerrada, el bot nunca intenta mandar un mensaje libre: el mensaje queda bloqueado y aparece en la bandeja para que lo resuelva una persona. Los avisos con plantillas a clientes de otros canales pasan a la fase 2.

### Traspaso a humano

- **Cuándo deriva:** el cliente pide hablar con una persona, el bot no entiende tras dos intentos, hay un reclamo, el pedido es muy complejo o está fuera del catálogo.
- **Qué pasa:** la conversación pasa a "esperando humano", suena una alerta en recepción y el bot deja de responder. Un recepcionista la toma y queda asignada a él.
- **Al terminar:** puede devolverla al bot o cerrarla. Si nadie la toma en unos minutos configurables, el bot avisa al cliente que lo van a atender.
- **Bandeja:** pantalla en tiempo real con las conversaciones por estado. Permite ver el historial, escribir y crear el pedido desde la propia conversación.

### Reglas de seguridad

- Precios, productos y disponibilidad salen siempre de la base de datos. La IA llama a funciones del sistema y no inventa datos.
- Nunca se crea un pedido sin confirmación explícita del cliente.
- Todos los mensajes se guardan para auditar errores y mejorar el bot.

* **IA del bot, a definir:** proveedor y modelo, validación de lo que devuelve, comportamiento si falla o tarda (propuesta a evaluar: pasar la conversación a "esperando humano"), qué datos del cliente se envían al proveedor y costo por local.

### Alta de WhatsApp por local

**Decisión:** el alta se hace de forma manual, tenant por tenant, con asistencia del desarrollador. Por ahora no se usa Embedded Signup propio ni se es Tech Provider.

- Cada local tiene su número propio y su cuenta de WhatsApp Business propia, a su nombre, y paga a Meta directamente el costo de los mensajes.
- En el alta se obtienen tres datos por tenant: el ID de la cuenta, el ID del número y una clave de acceso. Se cargan en la configuración de ese tenant dentro del sistema.
- No hace falta verificar la empresa del desarrollador ante Meta para operar. La verificación del negocio del local tampoco es obligatoria para empezar: responder a clientes que escriben primero no tiene límite, y solo se limita iniciar conversaciones masivas.
- **Número dedicado a la API:** en el alta manual, el número del local probablemente deja de usarse en la app del celular. Hay que confirmarlo en la documentación de Meta antes de prometerlo a un local.
- **Panel de chat propio:** la intervención humana se hace desde un panel dentro del sistema, donde el recepcionista toma la conversación cuando el bot no alcanza. Es parte del diseño de la fase 2.
- **Plantillas (fase 2):** de categoría utilidad y sin lenguaje promocional (si Meta detecta promoción las reclasifica como marketing, que cuesta más): confirmación de pedido programado, estado del pedido y aviso de no entregado. Cada local tiene su propia cuenta, así que se crean y se aprueban en cada una.
- **Costo variable: lo paga cada local.** Cada local carga su método de pago en Meta y Meta le factura directamente; el SaaS no cobra ni absorbe mensajería. Desde el 1 de octubre de 2026 Meta cobra por mensaje los mensajes libres y las plantillas de utilidad dentro de la ventana, con 1.000 mensajes de servicio gratis por mes por número. El Dueño tiene que saberlo desde el alta del local. El sistema guarda la categoría de cada mensaje, avisa al Dueño al acercarse a los 1.000 mensajes y si un envío falla por falta de pago, y el bot usa pocos mensajes (botones y listas). Pendiente: verificar la tarifa vigente para Argentina.

**Preparación técnica desde el MVP:** una tabla de cuentas de WhatsApp por tenant (ID de cuenta, ID de número y clave guardada cifrada); una capa que aísle el envío y la recepción de mensajes del resto del bot, para poder migrar a un proveedor o a Embedded Signup sin reescribirlo; y desarrollo y pruebas del bot con el número de prueba que da Meta, sin depender del alta de un local real.

**Más adelante:** revisar un proveedor (360dialog, Twilio) si el costo es razonable y permite que el local mantenga su número en la app, y evaluar ser Tech Provider cuando haya varios locales y la situación legal permita verificar el negocio.

## Configuración del tenant

Estas son las opciones que el Dueño puede ajustar sin ayuda técnica:

- Datos del negocio y logo.
- Medios de pago habilitados.
- Horarios de atención.
- Monto fijo del envío de delivery (las zonas y montos por distancia quedan para la fase 2).
- Tiempos estimados de preparación.
- Impresión: si la comanda del bot sale automáticamente, y los textos del ticket.
- Comportamiento del bot: mensajes, horarios, confirmación automática o revisión humana, cuándo deriva a una persona y espera antes de avisar al cliente.
- Alertas de stock mínimo, si controla stock y si bloquea o solo advierte ante stock insuficiente.
- Caja: si bloquea el cierre con rendiciones pendientes.
- Cuenta de WhatsApp del local: ID de cuenta, ID de número y clave de acceso (fase 2).
- Moneda y redondeo.
- Roles y permisos.

* Topes del Recepcionista (descuento, egreso y acumulado de egresos por turno) y si un pago pendiente al entregar solo avisa o bloquea.
* Historial de accesos de soporte a su local (solo lectura).

## Estado del local, soporte y monitoreo

**Modo soporte.** Para diagnosticar un problema sin usar nunca la contraseña de un usuario y sin acceso permanente a ningún local, un administrador de la plataforma puede abrir una sesión de soporte: solo lectura, 30 minutos fijos, con motivo obligatorio y registrada en una auditoría que el Dueño ve en su pantalla "Accesos de soporte". Las exportaciones quedan prohibidas en este modo. No se pide autorización previa del Dueño en el MVP, porque haría lento el soporte urgente; los términos de uso informan que el soporte puede acceder en modo lectura y que el acceso queda registrado y es visible para el Dueño. En modo lectura se puede diagnosticar pero no corregir; más adelante se pueden agregar acciones puntuales y auditadas, nunca un modo de escritura general.

**Monitoreo.** Better Stack, plan gratuito, como única herramienta en el MVP: un monitor sobre el estado del sistema, señales de las tareas programadas (cierre de caja, backups), un monitor sobre el webhook de WhatsApp, captura de errores del backend y logs estructurados. Las alertas llegan por email y por Slack o Telegram, solo ante caídas, tareas que no se ejecutaron y errores nuevos o repetidos.

**Hosting.** La decisión final se toma cuando el sistema llegue a despliegue. En el documento del backend hay una propuesta provisional y lo que hay que verificar.

## Planes, sucursales y precios del mercado

El mercado cobra por sucursal más que por un tope duro, y la propuesta es seguir ese modelo: un plan base con 1 sucursal, sucursales adicionales a un precio menor (por ejemplo 50% del base) y un máximo de autoservicio de 5. Para más, el cliente te contacta. Es una tabla de configuración y se puede cambiar sin tocar código.

Referencias relevadas el 2026-11-17 (precios de páginas públicas con fechas distintas y con inflación: hay que revalidarlos antes de fijar el tuyo):

| Competidor | Precio de referencia | Incluye |
| --- | --- | --- |
| [Pedix](https://info.pedix.app/ar/dietetica-tiendas-saludables/) | $19.000 a $35.000 por mes | El plan Pro suma POS, delivery y factura A/B/C |
| [Pedisy](https://www.pedisy.com/precios) | $30.000 (Esencial) y $65.000 (Avanzado) por mes | Esencial: tienda online, pedidos y POS. Avanzado: facturación ARCA, cocina, costos y reportes |
| [PedíMesa](https://pedimesa.online/blog/como-sacar-costos-para-vender-comida) | $38.000 por mes | Plan único con todos los módulos |
| [Fudo](https://madi-rest.com/blog/fudo-precio-2026) | Estimado USD 39 a 130 por mes por sucursal | Estimación de un competidor (Madi Rest), no oficial; la página oficial encontrada es la de México |

Pedix y Pedisy ya incluyen facturación ARCA en sus planes medios, y Pedisy ofrece un plan con IA.

## Reportes y uso de datos

Los reportes no solo muestran información: apuntan a ayudar a decidir. Para eso el MVP registra bien los datos desde el día uno: fecha y hora, canal, sucursal, ítems, descuentos, medio de pago y tiempos entre estados.

- **MVP:** reportes descriptivos y resumen de cierre de caja (ventas por canal y medio de pago, ticket promedio, cancelaciones, descuentos). Con el costo manual de cada variante se puede ver el margen. También se ven los extras vendidos, las pérdidas por pedidos no entregados y las diferencias de rendición por repartidor y por período.
- **Fase 3, sin machine learning al principio:** productos más vendidos por franja horaria, alertas de stock según rotación, sugerencia de cuánto producir mañana según el mismo día de las últimas semanas y detección de productos que no rotan.
- **Límite conocido:** sin recetas no hay costo real por producto, así que las predicciones sobre insumos son limitadas.

## Local piloto

Todavía no hay un negocio confirmado: la tarea es definir el perfil del local piloto y conseguirlo. El flujo de delivery de este documento se validó con el funcionamiento actual de un local.

**Perfil buscado:**

- Rotisería o fast food con mostrador.
- Que ya haga delivery y reciba pedidos por WhatsApp.
- Con el dueño disponible para dar feedback.
- Que acepte un piloto gratuito o con descuento.
- Idealmente cerca, para poder visitarlo.

**Búsqueda:** locales de Villa del Rosario y alrededores, o conocidos con un local. Mientras no haya piloto, entrevistas cortas a 3 o 4 dueños de rotiserías.

## Decisiones abiertas y riesgos

- [x] **Extras con precio:** ¿hay extras que se cobren aparte (agregar huevo, cambiar guarnición con recargo)? Resuelto: entran al MVP con precio fijo (ver Extras con precio).
- [ ] **Local piloto:** todavía no hay un negocio confirmado; definir el perfil buscado (ver Local piloto), conseguirlo y validar con él variantes, extras y precio.
- [x] **Alta de WhatsApp por local:** definir cómo conecta cada tenant su número a la API oficial de Meta (número propio, proveedor, plantillas). Resuelto: alta manual, tenant por tenant (ver Alta de WhatsApp por local).
- [ ] **Costos del bot:** la mensajería la paga cada local (decidido). Pendiente: verificar la tarifa vigente de Meta para Argentina y definir la IA del bot (proveedor, modelo y costo) antes de fijar el precio del plan. Se deja para después de la primera versión funcional.
- [ ] **Promociones y ARCA:** confirmar con el piloto si pasan al MVP, porque los competidores incluyen facturación en planes medios.
- [ ] **Precio y límite de sucursales:** validar el modelo (base + adicionales, máximo 5) con clientes reales.
- [ ] **Impresión:** incluir la configuración de Chrome en modo kiosco en el onboarding de cada local.
- [ ] **Backend y API:** Resuelto: la arquitectura técnica (multitenancy, permisos, endpoints, monitoreo y propuesta de hosting) está en el documento del backend.
- [x] **Interfaz web del repartidor:** Resuelto: accede desde el celular con usuario y contraseña, con su rol de Delivery y sesión larga. El repartidor ve sus pedidos asignados, confirma la entrega y registra "No entregado" con su motivo. No registra con cuánto pagó el cliente, porque ya queda anotado al tomar el pedido.

* [ ] **Hosting:** decisión final al llegar al despliegue; propuesta provisional y puntos a verificar en el documento del backend.
* [ ] **IA del bot:** proveedor, modelo, validación, comportamiento ante fallas, datos que se envían y costo.
