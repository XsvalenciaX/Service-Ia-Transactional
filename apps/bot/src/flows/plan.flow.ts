import { addKeyword } from "@builderbot/bot";
import { conversationStateService, planService } from "@energy-bot/services";
import type { FlowContext, FlowMethods } from "../types/flow.js";

// Entrado únicamente vía gotoFlow desde appliances.flow.ts, nunca por keyword directa del usuario.
export const planFlow = addKeyword(["_planFlow_"]).addAction(
  async (ctx: FlowContext, { flowDynamic }: FlowMethods) => {
    const { user } = await conversationStateService.getOrCreateSession(ctx.from);

    await flowDynamic("Dame un segundo que armo tu plan… ⚡");

    // El modelo recibe el consumo extraído del recibo + los hábitos que
    // contestó el usuario (ver packages/services/src/plan/plan.service.ts).
    const { content, personalized, targetKwh } =
      await planService.generateSavingsPlan(user.id);

    // Al usuario se le promete el 10%, aunque el plan que armó la IA esté
    // diseñado para 15% (ver PLAN_REDUCTION_PERCENT): esa diferencia es el
    // colchón para que la meta se cumpla aunque lo siga a medias.
    //
    // Un solo mensaje con los datos del plan (resumen + meta en kWh + aviso
    // de no-personalizado si aplica) en vez de tres — cada mensaje libre
    // adicional se paga por tarifa de mensajería, sin importar qué tan corto sea.
    const targetLine =
      targetKwh !== undefined
        ? `\n\n🎯 Buscando que sea *${targetKwh} kWh* o menos en la próxima factura.`
        : "";
    const personalizedLine = !personalized
      ? "\n\n⚠️ Ojo: no pude personalizarlo con tus datos en este momento, así que te di las recomendaciones generales."
      : "";

    await flowDynamic(
      `✅ Listo, este es tu plan para bajar un *${planService.PROMISED_REDUCTION_PERCENT}%* tu consumo:\n\n${content.summary}${targetLine}${personalizedLine}`
    );

    const recomendaciones = content.recommendations
      .map((texto, i) => `${i + 1}. ${texto}`)
      .join("\n\n");

    const state = await conversationStateService.markPlanReady(user.id);

    const availableAt = conversationStateService.nextPlanAvailableAt(state);
    const availableAtLabel = availableAt
      ? new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(
          availableAt
        )
      : null;

    // La fecha del próximo plan cierra el mensaje de "qué hacer" en vez de
    // ir aparte: mismo motivo que arriba, un mensaje libre menos por usuario.
    const nextPlanLine = availableAtLabel
      ? `\n\n📅 Podrás generar un plan nuevo a partir del *${availableAtLabel}*.`
      : "";

    await flowDynamic(`📋 *Qué hacer:*\n\n${recomendaciones}${nextPlanLine}`);
  }
);
