import { addKeyword, EVENTS } from "@builderbot/bot";
import {
  conversationStateService,
  receiptService,
  ConversationStep,
} from "@energy-bot/services";
import { applianceIntroFlow } from "./appliances.flow.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";

export const receiptFlow = addKeyword(EVENTS.MEDIA).addAction(
  async (ctx: FlowContext, { provider, flowDynamic, gotoFlow }: FlowMethods) => {
    const { user, state } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep !== ConversationStep.AWAITING_RECEIPT) {
      // No estábamos esperando un recibo de este usuario en este momento.
      return;
    }

    const imagePath = await provider.saveFile(ctx, { path: "./uploads" });

    // La IA (ver receipt.service.ts) valida si la imagen es un recibo
    // legible y, si lo es, extrae el consumo. Hoy la llamada al modelo está
    // mockeada, pero el flow ya reacciona al resultado como lo hará con la
    // IA real.
    const { analysis } = await receiptService.processReceipt(user.id, imagePath);

    if (!analysis.valid) {
      await flowDynamic(
        `⚠️ No pude leer el recibo. ${
          analysis.recommendation ??
          "Probá enviar una foto más clara, con todo el recibo dentro del encuadre."
        }`
      );
      // Nos quedamos en AWAITING_RECEIPT: el usuario puede volver a mandar la foto.
      return;
    }

    await flowDynamic(
      "📄 ¡Recibí tu recibo! Ahora te haré unas preguntas rápidas sobre tus electrodomésticos."
    );

    await conversationStateService.advanceStep(
      user.id,
      ConversationStep.ASKING_AIRE
    );

    return gotoFlow(applianceIntroFlow);
  }
);
