import { addKeyword } from "@builderbot/bot";
import { conversationStateService, ConversationStep } from "@energy-bot/services";
import { welcomeFlow } from "./welcome.flow.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";

export const RESTART_KEYWORDS = ["reiniciar", "reset", "empezar de nuevo"];

/**
 * Un usuario que ya terminó el flujo queda en COMPLETED y a partir de ahí
 * ningún flow le responde (welcomeFlow corta con endFlow()), así que sin
 * esto la única forma de volver a probar es tocar la base a mano.
 *
 * Los pasos que capturan respuestas se comen el mensaje antes de que
 * BuilderBot mire las keywords, por eso appliances.flow.ts chequea
 * `isRestartCommand` y salta acá con gotoFlow.
 */
export function isRestartCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return RESTART_KEYWORDS.includes(normalized);
}

/**
 * Habilitado en todos los entornos mientras seguimos en pruebas. Cuando
 * pasemos a producción hay que volver a restringirlo (ver
 * conversationStateService.MIN_DAYS_BETWEEN_PLANS y lockUntilTomorrow).
 */
function isRestartAllowed(): boolean {
  return true;
}

export const restartFlow = addKeyword(RESTART_KEYWORDS).addAction(
  async (ctx: FlowContext, { flowDynamic, gotoFlow }: FlowMethods) => {
    const { user, state, justUnlocked } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    // Bloqueado: ni "reiniciar" lo saca del castigo hasta que pase el día.
    if (!justUnlocked && state.currentStep === ConversationStep.LOCKED) {
      return;
    }

    if (!isRestartAllowed()) {
      // En producción tratamos "reiniciar" como cualquier otro mensaje.
      return gotoFlow(welcomeFlow);
    }

    await conversationStateService.resetConversation(user.id);

    await flowDynamic(
      "🔄 Listo, empezamos de cero. Borré tu recibo y tus respuestas anteriores."
    );

    // El estado ya volvió a WELCOME, así que welcomeFlow saluda y vuelve a
    // pedir el recibo en vez de cortar.
    return gotoFlow(welcomeFlow);
  }
);
