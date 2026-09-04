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

export interface Session {
  user: User;
  state: ConversationState;
}

/**
 * Resolves (creating if needed) the user and their conversation state from
 * their WhatsApp phone number. Every flow step calls this to know who it is
 * talking to and which step of the conversation they are in.
 */
export async function getOrCreateSession(
  phone: string,
  name?: string
): Promise<Session> {
  const user = await userRepository.findOrCreateByPhone(phone, name);
  const state = await conversationStateRepository.getOrCreate(user.id);
  return { user, state };
}

export async function advanceStep(
  userId: string,
  step: ConversationStep
): Promise<ConversationState> {
  return conversationStateRepository.setStep(userId, step);
}

/**
 * Suma un intento fallido de leer el consumo promedio de una foto y devuelve
 * en cuál va. A partir del tercero, el flow le pide al usuario que escriba el
 * número a mano en vez de seguir pidiéndole fotos.
 */
export async function registerReceiptAttempt(userId: string): Promise<number> {
  const state = await conversationStateRepository.registerReceiptAttempt(userId);
  return state.receiptAttempts;
}

/**
 * Deja al usuario como si nunca hubiera escrito: borra su recibo, sus
 * electrodomésticos y su plan, y lo devuelve al paso de bienvenida. Sin
 * borrar los datos previos el flujo se repetiría sobre ellos y el plan
 * terminaría generándose con electrodomésticos duplicados.
 */
export async function resetConversation(
  userId: string
): Promise<ConversationState> {
  await planRepository.deleteAllByUserId(userId);
  await applianceRepository.deleteAllByUserId(userId);
  await receiptRepository.deleteAllByUserId(userId);
  await conversationStateRepository.resetReceiptAttempts(userId);
  return conversationStateRepository.setStep(userId, ConversationStep.WELCOME);
}
