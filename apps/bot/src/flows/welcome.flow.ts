import { addKeyword, EVENTS } from "@builderbot/bot";
import { conversationStateService, ConversationStep } from "@energy-bot/services";
import type { FlowContext, FlowMethods } from "../types/flow.js";

/**
 * EVENTS.WELCOME es el catch-all de BuilderBot: le llega todo el texto que no
 * matchea ninguna keyword ni un `capture` pendiente. Sirve para varias cosas
 * distintas según en qué paso esté el usuario:
 *
 * - En WELCOME, el primer mensaje: lo saludamos y le pedimos el recibo.
 * - Bloqueado (LOCKED): no le contestamos nada hasta que pase el bloqueo.
 * - Recién desbloqueado: se lo avisamos y le repetimos el pedido de la foto.
 * - Recién habilitado para un plan nuevo (pasaron los días mínimos desde el
 *   último): se lo avisamos y le pedimos la foto del recibo actualizado.
 * - Esperando la foto (AWAITING_RECEIPT): si escribe texto en vez de mandar
 *   la foto, se lo recordamos.
 * - Plan listo (COMPLETED): mensaje fijo. El bot es 100% guiado, no hay IA
 *   respondiendo texto libre — los comandos para ver el plan, borrar el
 *   progreso, etc. van a vivir en una plantilla aparte.
 * - Cualquier otro paso (ASKING_*): son pasos que sólo se contestan por
 *   `gotoFlow` + `capture`, nunca por keyword, así que llegar acá significa
 *   que el flujo se cortó a mitad de camino y no hay forma de retomarlo. Se
 *   trata como estado huérfano: se borran los datos de ese intento y se
 *   arranca de cero (ver el bloque final de este action).
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
