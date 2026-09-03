import {
  userRepository,
  conversationStateRepository,
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
