import { addKeyword, EVENTS } from "@builderbot/bot";
import {
  assistantService,
  conversationStateService,
  ConversationStep,
} from "@energy-bot/services";
import { isTextMessage } from "../utils/message-validation.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";

/**
 * EVENTS.WELCOME es el catch-all de BuilderBot: le llega todo el texto que no
 * matchea ninguna keyword ni un `capture` pendiente. Sirve para dos cosas
 * distintas según en qué paso esté el usuario:
 *
 * - En WELCOME, el primer mensaje: lo saludamos y le pedimos el recibo.
 * - Más adelante, cualquier cosa que escriba fuera de guion (una pregunta
 *   sobre su plan, o algo que no tiene nada que ver): la contesta la IA.
 *   Antes acá se cortaba con endFlow() y el bot se quedaba mudo.
 */
export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx: FlowContext, { flowDynamic, endFlow }: FlowMethods) => {
    const { user, state } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep === ConversationStep.WELCOME) {

      await flowDynamic(
          "¡Hola! 👋 Soy tu asistente de ahorro energético para tu hogar o comercio. Te voy a ayudar a crear un plan personalizado para reducir tu consumo eléctrico en un 10% o más."
        );

      await flowDynamic(
          "Para empezar, envíame una *foto de tu recibo o factura de energía* más reciente.\nToma la foto donde se muestre el consumo promedio en kWh. 📸"
        );

      await conversationStateService.advanceStep(
        user.id,
        ConversationStep.AWAITING_RECEIPT
      );
      return;
    }

    // Audios, stickers y demás: no hay nada que responder.
    if (!isTextMessage(ctx)) {
      return endFlow();
    }

    const { reply } = await assistantService.answerQuestion(
      user.id,
      ctx.body,
      state.currentStep
    );

    await flowDynamic(reply);
  }
);
