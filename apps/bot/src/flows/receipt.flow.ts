import { addKeyword, EVENTS } from "@builderbot/bot";
import {
  conversationStateService,
  receiptService,
  ConversationStep,
} from "@energy-bot/services";
import { applianceIntroFlow } from "./appliances.flow.js";
import { manualConsumptionFlow } from "./manual-consumption.flow.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";

export const receiptFlow = addKeyword(EVENTS.MEDIA).addAction(
  async (ctx: FlowContext, { provider, flowDynamic, gotoFlow }: FlowMethods) => {
    const { user, state } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep !== ConversationStep.AWAITING_RECEIPT) {
      // No estábamos esperando un recibo de este usuario en este momento
      // (cubre también a los usuarios LOCKED: ese step nunca es este).
      return;
    }

    const imagePath = await provider.saveFile(ctx, { path: "./uploads" });

    await flowDynamic("Dejame leer el recibo… 👀");

    // La IA (ver receipt.service.ts) valida si la imagen es un recibo
    // legible y, si lo es, extrae el consumo.
    const { analysis } = await receiptService.processReceipt(user.id, imagePath);

    if (!analysis.valid) {
      const updated = await conversationStateService.registerFailedReceiptAttempt(
        user.id
      );

      if (updated.receiptAttempts >= conversationStateService.MAX_RECEIPT_ATTEMPTS) {
        await flowDynamic(
          `⚠️ No pude leer tu recibo después de ${conversationStateService.MAX_RECEIPT_ATTEMPTS} intentos. ` +
            "Escribime el *consumo promedio en kWh* de tu factura (por ejemplo: 350)."
        );
        await conversationStateService.advanceStep(
          user.id,
          ConversationStep.ASKING_MANUAL_CONSUMPTION
        );
        return gotoFlow(manualConsumptionFlow);
      }

      await flowDynamic(
        `⚠️ No pude leer el recibo (intento ${updated.receiptAttempts}/${conversationStateService.MAX_RECEIPT_ATTEMPTS}). ${
          analysis.recommendation ??
          "Probá enviar una foto más clara, con todo el recibo dentro del encuadre."
        }`
      );
      // Nos quedamos en AWAITING_RECEIPT: el usuario puede volver a mandar la foto.
      return;
    }

    // Repetirle lo que leímos le deja corregir de entrada si la IA se
    // equivocó, en vez de descubrirlo recién en el plan final.
    const consumo =
      analysis.consumptionKwh !== undefined
        ? `Leí un consumo de *${analysis.consumptionKwh} kWh*`
        : "Pude leer tu recibo";
    const monto =
      analysis.amount !== undefined
        ? ` por *${analysis.amount.toLocaleString("es-CO")} ${analysis.currency ?? ""}*`.trimEnd()
        : "";

    await flowDynamic(
      `📄 ${consumo}${monto}. Ahora te haré unas preguntas rápidas sobre tus electrodomésticos.`
    );

    await conversationStateService.advanceStep(
      user.id,
      ConversationStep.ASKING_AIRE
    );

    return gotoFlow(applianceIntroFlow);
  }
);
