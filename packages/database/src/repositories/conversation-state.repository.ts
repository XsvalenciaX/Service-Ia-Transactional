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

export async function incrementReceiptAttempts(
  userId: string
): Promise<ConversationState> {
  return prisma.conversationState.update({
    where: { userId },
    data: { receiptAttempts: { increment: 1 } },
  });
}

export async function setLockout(
  userId: string,
  lockedUntil: Date
): Promise<ConversationState> {
  return prisma.conversationState.update({
    where: { userId },
    data: { currentStep: ConversationStep.LOCKED, lockedUntil },
  });
}

export async function setPlanReady(userId: string): Promise<ConversationState> {
  return prisma.conversationState.update({
    where: { userId },
    data: { planReadyAt: new Date() },
  });
}

/**
 * Vuelve a `resetStep` y borra intentos/bloqueo/fecha del último plan. Se
 * usa para el auto-reseteo cuando vence el bloqueo o cuando ya se puede
 * generar un plan nuevo (-> AWAITING_RECEIPT), y para un "reiniciar" manual
 * (-> WELCOME).
 */
export async function resetState(
  userId: string,
  resetStep: ConversationStep
): Promise<ConversationState> {
  return prisma.conversationState.update({
    where: { userId },
    data: {
      currentStep: resetStep,
      lockedUntil: null,
      receiptAttempts: 0,
      planReadyAt: null,
    },
  });
}

export { ConversationStep };
