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
 * - En cualquier otro paso (típicamente COMPLETED): mensaje fijo. El bot es
 *   100% guiado, no hay IA respondiendo texto libre — los comandos para ver
 *   el plan, borrar el progreso, etc. van a vivir en una plantilla aparte.
 */
export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx: FlowContext, { flowDynamic, endFlow }: FlowMethods) => {
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

    if (state.currentStep === ConversationStep.AWAITING_RECEIPT) {
      await flowDynamic(
        "Necesito que me mandes la *foto* de tu recibo para seguir. 📸"
      );
      return;
    }

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
  }
);
