import { prisma } from "../client.js";
import { ConversationStep } from "../../generated/prisma/client.js";
import type { ConversationState } from "../../generated/prisma/client.js";

export async function getOrCreate(userId: string): Promise<ConversationState> {
  return prisma.conversationState.upsert({
    where: { userId },
    update: {},
    create: { userId, currentStep: ConversationStep.WELCOME },
  });
}

export async function setStep(
  userId: string,
  currentStep: ConversationStep
): Promise<ConversationState> {
  return prisma.conversationState.upsert({
    where: { userId },
    update: { currentStep },
    create: { userId, currentStep },
  });
}

/**
 * Suma uno a los intentos de foto que no dieron el consumo promedio y
 * devuelve el estado ya actualizado, para que el flow sepa en qué intento va.
 */
export async function registerReceiptAttempt(
  userId: string
): Promise<ConversationState> {
  return prisma.conversationState.upsert({
    where: { userId },
    update: { receiptAttempts: { increment: 1 } },
    create: { userId, receiptAttempts: 1 },
  });
}

export async function resetReceiptAttempts(
  userId: string
): Promise<ConversationState> {
  return prisma.conversationState.upsert({
    where: { userId },
    // Reabre también la conversación: si se había cerrado por agotar los
    // intentos, empezar de cero es justamente lo que la vuelve a habilitar.
    update: { receiptAttempts: 0, closedAt: null },
    create: { userId },
  });
}

/**
 * Marca la conversación como cerrada por haber agotado los intentos de foto.
 * Se guarda la fecha, no un booleano, porque el cierre dura sólo el mes
 * calendario en curso: con la factura del mes siguiente vuelve a habilitarse.
 */
export async function closeConversation(
  userId: string
): Promise<ConversationState> {
  return prisma.conversationState.upsert({
    where: { userId },
    update: { closedAt: new Date() },
    create: { userId, closedAt: new Date() },
  });
}

export { ConversationStep };
