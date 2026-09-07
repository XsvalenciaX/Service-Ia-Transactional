import { addKeyword, EVENTS } from "@builderbot/bot";
import {
  assistantService,
  conversationStateService,
  receiptService,
  ConversationStep,
} from "@energy-bot/services";
import { applianceIntroFlow } from "./appliances.flow.js";
import {
  extractKwh,
  isStandaloneKwh,
  isTextMessage,
} from "../utils/message-validation.js";
import { buildClosedMessage } from "../utils/monthly-plan.js";
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
  async (ctx: FlowContext, { flowDynamic, endFlow, gotoFlow }: FlowMethods) => {
    const { user, state } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep === ConversationStep.WELCOME) {

      await flowDynamic(
          "¡Hola! 👋 Soy tu asistente de ahorro energético para tu hogar. Te voy a ayudar a crear un plan personalizado para reducir tu consumo eléctrico en un 10% o más."
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

    // El proceso de este mes se cerró por agotar los intentos de foto: no se
    // acepta ni el número a mano ni se gastan llamadas contestando preguntas.
    if (conversationStateService.isConversationClosed(state)) {
      await flowDynamic(buildClosedMessage());
      return;
    }

    // Llegó el mes siguiente: el cierre expiró y le devolvemos los intentos.
    await conversationStateService.reopenIfExpired(state);

    // Audios, stickers y demás: no hay nada que responder.
    if (!isTextMessage(ctx)) {
      return endFlow();
    }

    // Mientras esperamos el recibo, un mensaje con un número es el consumo
    // promedio que le pedimos escribir porque la foto no alcanzó.
    if (state.currentStep === ConversationStep.AWAITING_RECEIPT) {
      // Sólo tomamos el número si el mensaje *es* el número: una frase que
      // casualmente trae cifras ("quién ganó el mundial 2022") es una
      // pregunta para la IA, no el consumo promedio.
      const kwh = isStandaloneKwh(ctx.body) ? extractKwh(ctx.body) : undefined;

      if (kwh !== undefined && receiptService.isPlausibleConsumption(kwh)) {
        await receiptService.registerManualAverageConsumption(user.id, kwh);
        await flowDynamic(
          `📄 Anotado: *${kwh} kWh* de consumo promedio.\n\nAhora te haré unas preguntas rápidas sobre tus electrodomésticos.`
        );
        await conversationStateService.advanceStep(
          user.id,
          ConversationStep.ASKING_AIRE
        );
        return gotoFlow(applianceIntroFlow);
      }

      if (kwh !== undefined) {
        // Trajo un número, pero no puede ser un consumo mensual: si lo
        // guardáramos, el plan saldría con cuentas absurdas.
        await flowDynamic(
          `Ese valor (*${kwh}*) no parece un consumo promedio mensual: normalmente está entre ${receiptService.MIN_CONSUMPTION_KWH} y ${receiptService.MAX_CONSUMPTION_KWH} kWh.\n\n` +
            "Revisa tu factura y envíame el número en kWh, o una foto de la factura completa."
        );
        return;
      }
    }

    const { reply } = await assistantService.answerQuestion(
      user.id,
      ctx.body,
      state.currentStep
    );

    await flowDynamic(reply);
  }
);
