import { addKeyword, EVENTS } from "@builderbot/bot";
import { conversationStateService, ConversationStep } from "@energy-bot/services";
import type { FlowContext, FlowMethods } from "../types/flow.js";

/**
 * EVENTS.WELCOME es el catch-all de BuilderBot: le llega todo el texto que
 * no matchea ninguna keyword ni un `capture` pendiente. Qué responde
 * depende del paso en el que esté el usuario (`state.currentStep`, casos
 * abajo); el bot es 100% guiado, no hay IA respondiendo texto libre.
 */
export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx: FlowContext, { flowDynamic, endFlow, gotoFlow }: FlowMethods) => {
    const { user, state, justUnlocked, planRenewed } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep === ConversationStep.LOCKED) {
      return endFlow();
    }

    if (justUnlocked) {
      await flowDynamic(
        "🔓 Ya pasó el día de espera. Mandame de nuevo la *foto de tu recibo o factura de energía* más reciente. 📸"
      );
      return;
    }

    if (planRenewed) {
      await flowDynamic(
        `🎉 Ya pasaron ${conversationStateService.MIN_DAYS_BETWEEN_PLANS} días desde tu último plan — ¡hagamos uno nuevo! Mandame la *foto de tu recibo o factura de energía* más reciente. 📸`
      );
      return;
    }

    if (state.currentStep === ConversationStep.WELCOME) {

      await flowDynamic(
          "¡Hola! 👋 Soy Wattson, tu asistente de ahorro energético para el hogar. Te ayudaré a crear un plan personalizado para reducir tu consumo eléctrico en un 10% o más."
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

    if (state.currentStep === ConversationStep.AWAITING_RECEIPT) {
      await flowDynamic(
        "Necesito que me mandes la *foto* de tu recibo para seguir. 📸"
      );
      return;
    }

    if (state.currentStep === ConversationStep.COMPLETED) {
      const availableAt = conversationStateService.nextPlanAvailableAt(state);
      const availableAtLabel = availableAt
        ? new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(
            availableAt
          )
        : null;

      await flowDynamic(
        availableAtLabel
          ? `Plan completado, podrás generar un plan nuevo a partir del *${availableAtLabel}*.`
          : "Plan completado. Para crear un plan nuevo deberás esperar unos días."
      );
      return;
    }

    // Cualquier otro paso (ASKING_MANUAL_CONSUMPTION, ASKING_APPLIANCE_SELECTION,
    // ASKING_AIRE, etc.) sólo se contesta vía gotoFlow con `capture: true` --
    // nunca por keyword de texto libre. Si el usuario llega hasta acá con uno
    // de esos pasos en state.currentStep es porque esa captura se perdió a
    // mitad de camino (el bot se reinició, un paso tiró un error no
    // atrapado) y no hay forma de retomar justo donde quedó. Mostrarle "plan
    // completado" ahí sería mentirle: no hay ningún plan armado. Mejor
    // borrarle los datos de este intento (recibo/electrodomésticos/plan) y
    // arrancar el flujo de cero, igual que hace restartFlow.
    await conversationStateService.resetConversation(user.id);

    await flowDynamic(
      "⚠️ Se cortó tu proceso a mitad de camino y no puedo retomarlo justo donde quedó. Vamos a empezar de nuevo, disculpá la molestia 🙏"
    );

    return gotoFlow(welcomeFlow);
  }
);
