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

export { ConversationStep };
