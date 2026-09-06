import { addKeyword } from "@builderbot/bot";
import {
  conversationStateService,
  receiptService,
  ConversationStep,
} from "@energy-bot/services";
import { applianceIntroFlow } from "./appliances.flow.js";
import { isRestartCommand, restartFlow } from "./restart.flow.js";
import { isTextMessage } from "../utils/message-validation.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";

const CONSUMPTION_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Único intento para dar el consumo promedio en kWh cuando ya se agotaron
 * los 3 intentos de foto (ver receipt.flow.ts). A diferencia de las
 * preguntas de electrodomésticos, acá no hay `fallBack`: si no matchea,
 * bloqueamos al usuario hasta el día siguiente en vez de repreguntar.
 *
 * Entrado únicamente vía gotoFlow desde receipt.flow.ts.
 */
export const manualConsumptionFlow = addKeyword(["_ask_manual_consumption_"]).addAction(
  { capture: true },
  async (ctx: FlowContext, { gotoFlow, flowDynamic }: FlowMethods) => {
    if (isRestartCommand(ctx.body)) {
      return gotoFlow(restartFlow);
    }

    const body = isTextMessage(ctx) ? ctx.body.trim() : "";
    const { user } = await conversationStateService.getOrCreateSession(ctx.from);

    if (!isTextMessage(ctx) || !CONSUMPTION_PATTERN.test(body)) {
      await conversationStateService.lockUntilTomorrow(user.id);
      await flowDynamic(
        "😕 Esa no es una respuesta válida. Vas a tener que esperar hasta *mañana* para volver a intentarlo."
      );
      return;
    }

    await receiptService.saveManualConsumption(user.id, Number(body));
    await flowDynamic(
      "👍 Listo, con ese dato sigo. Ahora te haré unas preguntas rápidas sobre tus electrodomésticos."
    );
    await conversationStateService.advanceStep(user.id, ConversationStep.ASKING_AIRE);
    return gotoFlow(applianceIntroFlow);
  }
);
