import {
  userRepository,
  conversationStateRepository,
  receiptRepository,
  applianceRepository,
  planRepository,
  ConversationStep,
  type User,
  type ConversationState,
} from "@energy-bot/database";

export { ConversationStep };

export const MAX_RECEIPT_ATTEMPTS = 3;
export const MIN_DAYS_BETWEEN_PLANS = 28;

const MIN_MS_BETWEEN_PLANS = MIN_DAYS_BETWEEN_PLANS * 24 * 60 * 60 * 1000;

export interface Session {
  user: User;
  state: ConversationState;
  /** true cuando este llamado detectó que el bloqueo ya venció y reseteó solo. */
  justUnlocked: boolean;
  /** true cuando este llamado detectó que ya se puede armar un plan nuevo y reseteó solo. */
  planRenewed: boolean;
}

function isLockoutOver(state: ConversationState): boolean {
  return (
    state.currentStep === ConversationStep.LOCKED &&
    state.lockedUntil !== null &&
    state.lockedUntil <= new Date()
  );
}

function isPlanCooldownOver(state: ConversationState): boolean {
  return (
    state.currentStep === ConversationStep.COMPLETED &&
    state.planReadyAt !== null &&
    Date.now() - state.planReadyAt.getTime() >= MIN_MS_BETWEEN_PLANS
  );
}

/** Fecha desde la que se puede generar un plan nuevo, o null si todavía no hay uno. */
export function nextPlanAvailableAt(state: ConversationState): Date | null {
  if (state.planReadyAt === null) {
    return null;
  }
  return new Date(state.planReadyAt.getTime() + MIN_MS_BETWEEN_PLANS);
}

/**
 * Resuelve (creando si hace falta) el usuario y su estado de conversación a
 * partir de su número de WhatsApp. Como todos los flows llaman a esto
 * primero, acá quedan centralizados los dos auto-reseteos que dependen del
 * paso del tiempo:
 *
 * - Bloqueado (LOCKED) y ya pasó `lockedUntil` -> vuelve a AWAITING_RECEIPT.
 * - Plan listo (COMPLETED) hace `MIN_DAYS_BETWEEN_PLANS` días o más -> borra
 *   el ciclo anterior y también vuelve a AWAITING_RECEIPT, para que pueda
 *   armar un plan nuevo.
 */
export async function getOrCreateSession(
  phone: string,
  name?: string
): Promise<Session> {
  const user = await userRepository.findOrCreateByPhone(phone, name);
  let state = await conversationStateRepository.getOrCreate(user.id);

  let justUnlocked = false;
  let planRenewed = false;

  if (isLockoutOver(state)) {
    state = await conversationStateRepository.resetState(
      user.id,
      ConversationStep.AWAITING_RECEIPT
    );
    justUnlocked = true;
  } else if (isPlanCooldownOver(state)) {
    state = await resetConversation(user.id, ConversationStep.AWAITING_RECEIPT);
    planRenewed = true;
  }

  return { user, state, justUnlocked, planRenewed };
}

export async function advanceStep(
  userId: string,
  step: ConversationStep
): Promise<ConversationState> {
  return conversationStateRepository.setStep(userId, step);
}

export async function registerFailedReceiptAttempt(
  userId: string
): Promise<ConversationState> {
  return conversationStateRepository.incrementReceiptAttempts(userId);
}

/** Medianoche del día siguiente al momento en que se llama. */
function startOfNextDay(): Date {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next;
}

export async function lockUntilTomorrow(userId: string): Promise<ConversationState> {
  return conversationStateRepository.setLockout(userId, startOfNextDay());
}

/** Se llama cuando el plan terminó de generarse (ver plan.flow.ts). */
export async function markPlanReady(userId: string): Promise<ConversationState> {
  return conversationStateRepository.setPlanReady(userId);
}

/**
 * Deja al usuario como si nunca hubiera escrito: borra su recibo, sus
 * electrodomésticos y su plan, y lo devuelve a `targetStep` (además de
 * limpiar intentos/bloqueo/fecha del plan). Sin borrar los datos previos el
 * flujo se repetiría sobre ellos y el plan terminaría generándose con
 * electrodomésticos duplicados.
 */
export async function resetConversation(
  userId: string,
  targetStep: ConversationStep = ConversationStep.WELCOME
): Promise<ConversationState> {
  await planRepository.deleteAllByUserId(userId);
  await applianceRepository.deleteAllByUserId(userId);
  await receiptRepository.deleteAllByUserId(userId);
  return conversationStateRepository.resetState(userId, targetStep);
}
