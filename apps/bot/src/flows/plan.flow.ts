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
    await flowDynamic(
      `✅ Listo, este es tu plan para bajar un *${planService.PROMISED_REDUCTION_PERCENT}%* tu consumo:\n\n${content.summary}`
    );

    if (targetKwh !== undefined) {
      await flowDynamic(
        `🎯 Buscando que sea *${targetKwh} kWh* o menos en la próxima factura.`
      );
    }

    const recomendaciones = content.recommendations
      .map((texto, i) => `${i + 1}. ${texto}`)
      .join("\n\n");

    await flowDynamic(`📋 *Qué hacer:*\n\n${recomendaciones}`);

    if (!personalized) {
      await flowDynamic(
        "⚠️ Ojo: no pude personalizarlo con tus datos en este momento, así que te di las recomendaciones generales."
      );
    }

    await conversationStateService.markPlanReady(user.id);
  }
);
