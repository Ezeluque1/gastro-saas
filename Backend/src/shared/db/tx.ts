import type { Prisma } from '../../generated/prisma/client.js';

/**
 * La transaccion que reciben servicios y repositorios.
 *
 * Es el unico handle a la base que se pasa entre capas y entre modulos: asi una
 * operacion que toca varios dominios (un pedido toca catalogo, stock y caja) se
 * confirma o se revierte junta.
 *
 * docs/Backend: "Capas dentro de cada modulo" y "Una transaccion, varios
 * modulos".
 */
export type Tx = Prisma.TransactionClient;
