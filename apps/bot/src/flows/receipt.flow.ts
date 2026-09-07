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

    // El promedio de los últimos meses es el dato del que sale la meta
    // (calculateTargetKwh trabaja sobre él), así que una lectura sin ese
    // número no alcanza para armar el plan: cuenta como intento fallido igual
    // que una foto ilegible. Sin esto el bot seguía de largo y el plan salía
    // sin objetivo en kWh.
    const faltaPromedio =
      analysis.valid && analysis.averageConsumptionKwh === undefined;

    if (!analysis.valid || faltaPromedio) {
      const updated = await conversationStateService.registerFailedReceiptAttempt(
        user.id
      );

      if (updated.receiptAttempts >= conversationStateService.MAX_RECEIPT_ATTEMPTS) {
        await flowDynamic(
          `⚠️ No pude sacar el consumo promedio de tu recibo después de ${conversationStateService.MAX_RECEIPT_ATTEMPTS} intentos. ` +
            "Escribime el *consumo promedio en kWh* de tu factura (por ejemplo: 350)."
        );
        await conversationStateService.advanceStep(
          user.id,
          ConversationStep.ASKING_MANUAL_CONSUMPTION
        );
        return gotoFlow(manualConsumptionFlow);
      }

      // El promedio casi siempre se pierde porque la foto corta el gráfico
      // del histórico, no porque la imagen esté mal: decirle "mandá una foto
      // más clara" lo manda a repetir el mismo encuadre.
      const detalle = faltaPromedio
        ? "Te leí el consumo del período, pero me falta el *consumo promedio*. " +
          'Está en el recuadro "Histórico de consumos (kWh) y promedio", en la ' +
          "última barra, marcada *PROM*. Mandame otra foto donde se vea ese gráfico completo."
        : analysis.recommendation ??
          "Probá enviar una foto más clara, con todo el recibo dentro del encuadre.";

      await flowDynamic(
        `⚠️ Todavía no puedo armar tu plan (intento ${updated.receiptAttempts}/${conversationStateService.MAX_RECEIPT_ATTEMPTS}). ${detalle}`
      );
      // Nos quedamos en AWAITING_RECEIPT: el usuario puede volver a mandar la foto.
      return;
    }

    // Repetirle lo que leímos le deja corregir de entrada si la IA se
    // equivocó, en vez de descubrirlo recién en el plan final. Nunca se le
    // menciona el monto: el bot habla de energía, no de plata.
    //
    // El promedio va sí o sí, y dicho como el número que manda: mostrando
    // sólo el consumo del período parecía que el bot había leído la barra
    // equivocada del gráfico (la "Actual" en vez de la "PROM").
    const periodo =
      analysis.consumptionKwh !== undefined
        ? `Leí un consumo de *${analysis.consumptionKwh} kWh* en el período facturado y `
        : "Leí tu recibo: ";

    await flowDynamic(
      `📄 ${periodo}un *consumo promedio* de *${analysis.averageConsumptionKwh} kWh* en los últimos meses.\n\n` +
        "Tu plan lo armo sobre el promedio. Ahora te haré unas preguntas rápidas sobre tus electrodomésticos."
    );

    await conversationStateService.advanceStep(
      user.id,
      ConversationStep.ASKING_AIRE
    );

    return gotoFlow(applianceIntroFlow);
  }
);
