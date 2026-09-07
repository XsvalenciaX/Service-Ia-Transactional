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
 * Cada proveedor entrega el número con su propio formato: Twilio manda
 * "+573145636836" y Baileys mandaba "573145636836". Sin normalizar, el mismo
 * teléfono termina como dos usuarios distintos y la persona pierde su
 * historial al cambiar de proveedor (o queda a mitad de un flujo que el bot
 * ya no encuentra). La clave canónica es solo dígitos.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
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
  const user = await userRepository.findOrCreateByPhone(
    normalizePhone(phone),
    name
  );
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
 * Cierra el proceso del mes porque el usuario agotó los intentos de foto sin
 * que pudiéramos sacarle el consumo. A partir de acá no se procesa ninguna
 * imagen más (que es lo que cuesta plata) ni se acepta el número a mano.
 */
export async function closeConversation(
  userId: string
): Promise<ConversationState> {
  return conversationStateRepository.closeConversation(userId);
}

/**
 * El cierre vale por el mes calendario: al mes siguiente le llega otra
 * factura y tiene derecho a volver a intentarlo. Se compara contra el mes en
 * curso en vez de guardar un booleano justamente para que expire solo.
 */
export function isConversationClosed(state: ConversationState): boolean {
  if (!state.closedAt) {
    return false;
  }

  const ahora = new Date();
  return (
    state.closedAt.getFullYear() === ahora.getFullYear() &&
    state.closedAt.getMonth() === ahora.getMonth()
  );
}

/**
 * Un cierre de un mes anterior ya expiró, pero `receiptAttempts` sigue en el
 * tope: sin devolverle los intentos, el primer traspié del mes nuevo lo
 * volvería a cerrar de entrada. Los flows llaman a esto antes de procesar.
 */
export async function reopenIfExpired(
  state: ConversationState
): Promise<void> {
  if (state.closedAt && !isConversationClosed(state)) {
    await conversationStateRepository.resetReceiptAttempts(state.userId);
  }
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
