import { logger } from '../logger/index.js';
import { captureError } from '../monitoring/index.js';

/**
 * Bus de eventos interno.
 *
 * Sirve para lo que NO es esencial a la operacion: impresion, avisos de
 * WhatsApp, alertas de stock minimo. Asi `orders` no depende de `whatsapp` ni
 * de impresion.
 *
 * Regla que no se negocia: un evento se emite DESPUES de confirmar la
 * transaccion. Lo que tiene que quedar guardado junto con el pedido (stock,
 * cobro, movimiento de caja) no usa eventos: se llama directo dentro de la
 * misma transaccion.
 *
 * Un suscriptor que falla no puede voltear la operacion que ya se confirmo:
 * su error se registra y se manda al monitoreo, pero no se propaga.
 *
 * docs/Backend: "Reglas de modularidad" (Eventos para lo que no es esencial).
 */

/**
 * Catalogo de eventos. Cada modulo suma los suyos a esta interfaz, lo que
 * mantiene tipado tanto al que emite como al que escucha.
 * Los eventos reales entran con sus modulos, desde la Fase 5.
 */
export interface DomainEvents {
  // Ejemplo de la forma que tendran. Se reemplaza en la Fase 5.
  'noop.ping': { readonly at: Date };
}

export type EventName = keyof DomainEvents;

type Handler<N extends EventName> = (payload: DomainEvents[N]) => void | Promise<void>;

const handlers = new Map<EventName, Set<Handler<EventName>>>();

export function on<N extends EventName>(event: N, handler: Handler<N>): () => void {
  const set = handlers.get(event) ?? new Set();
  set.add(handler as Handler<EventName>);
  handlers.set(event, set);

  return () => {
    set.delete(handler as Handler<EventName>);
  };
}

/**
 * Emite un evento. No espera a los suscriptores ni devuelve su resultado: la
 * request que lo emitio ya termino su trabajo.
 */
export function emit<N extends EventName>(event: N, payload: DomainEvents[N]): void {
  const set = handlers.get(event);
  if (set === undefined || set.size === 0) return;

  for (const handler of set) {
    void runSafely(event, handler, payload);
  }
}

async function runSafely<N extends EventName>(
  event: N,
  handler: Handler<EventName>,
  payload: DomainEvents[N],
): Promise<void> {
  try {
    await handler(payload);
  } catch (error) {
    logger.error({ err: error, event }, 'suscriptor de evento fallo');
    captureError(error, { path: `event:${event}` });
  }
}

/** Solo para las pruebas: deja el bus sin suscriptores. */
export function clearSubscribers(): void {
  handlers.clear();
}
