import { addKeyword } from "@builderbot/bot";
import { conversationStateService, planService } from "@energy-bot/services";
import type { FlowContext, FlowMethods } from "../types/flow.js";

// Entrado únicamente vía gotoFlow desde appliances.flow.ts, nunca por keyword directa del usuario.
export const planFlow = addKeyword(["_planFlow_"]).addAction(
  async (ctx: FlowContext, { flowDynamic }: FlowMethods) => {
    const { user } = await conversationStateService.getOrCreateSession(ctx.from);

    // TODO: lógica de IA - enviar el consumo extraído del recibo + los
    // hábitos de electrodomésticos a un LLM para generar el plan de ahorro
    // energético del 15% (ver packages/services/src/plan/plan.service.ts).
    await planService.generateSavingsPlan(user.id);

    await flowDynamic(
      "✅ Ya tengo toda tu información. Tu plan de ahorro personalizado está en camino (esto lo conectaremos con IA próximamente)."
    );
  }
);
