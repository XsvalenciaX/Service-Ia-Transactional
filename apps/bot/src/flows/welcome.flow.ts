import { addKeyword, EVENTS } from "@builderbot/bot";
import { conversationStateService, ConversationStep } from "@energy-bot/services";
import type { FlowContext, FlowMethods } from "../types/flow.js";

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx: FlowContext, { flowDynamic, endFlow }: FlowMethods) => {
    const { user, state } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep !== ConversationStep.WELCOME) {
      // El usuario ya está en otro punto del flujo; los demás flows
      // (media, preguntas) se encargan de continuar la conversación.
      return endFlow();
    }

    await flowDynamic(
      "¡Hola! 👋 Soy tu asistente de ahorro energético. Te voy a ayudar a armar un plan personalizado para reducir tu consumo eléctrico en un 15%."
    );
    await flowDynamic(
      "Para empezar, envíame una *foto de tu recibo de energía* más reciente. 📸"
    );

    await conversationStateService.advanceStep(
      user.id,
      ConversationStep.AWAITING_RECEIPT
    );
  }
);
