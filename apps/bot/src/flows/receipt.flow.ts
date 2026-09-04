import { addKeyword, EVENTS } from "@builderbot/bot";
import {
  conversationStateService,
  planService,
  receiptService,
  ConversationStep,
} from "@energy-bot/services";
import { applianceIntroFlow } from "./appliances.flow.js";
import { buildAlreadyDoneMessage } from "../utils/monthly-plan.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";

// A partir de este intento dejamos de pedir fotos y le pedimos derecho el
// número: si tres veces no salió, es probable que su factura no lo muestre o
// que la cámara no dé para más.
const MAX_INTENTOS_FOTO = 3;

export const receiptFlow = addKeyword(EVENTS.MEDIA).addAction(
  async (ctx: FlowContext, { provider, flowDynamic, gotoFlow }: FlowMethods) => {
    const { user, state } = await conversationStateService.getOrCreateSession(
      ctx.from
    );

    if (state.currentStep === ConversationStep.COMPLETED) {
      // Ya terminó el proceso alguna vez. Si el plan es de este mes se lo
      // decimos; si es de un mes anterior, la foto nueva arranca el ciclo del
      // mes siguiente.
      const { alreadyDoneThisMonth, generatedAt } =
        await planService.getMonthlyPlanStatus(user.id);

      if (alreadyDoneThisMonth) {
        await flowDynamic(buildAlreadyDoneMessage(generatedAt));
        return;
      }

      await conversationStateService.resetConversation(user.id);
      // resetConversation deja el paso en WELCOME; acá ya estamos recibiendo
      // la foto, así que lo dejamos donde corresponde por si la lectura falla
      // y el usuario tiene que reintentar.
      await conversationStateService.advanceStep(
        user.id,
        ConversationStep.AWAITING_RECEIPT
      );
      await flowDynamic(
        "📅 ¡Llegó tu nueva factura! Vamos a actualizar tu plan con este consumo."
      );
    } else if (state.currentStep !== ConversationStep.AWAITING_RECEIPT) {
      // Estamos en medio de las preguntas de electrodomésticos: la foto no
      // es lo que estábamos esperando.
      return;
    }

    const imagePath = await provider.saveFile(ctx, { path: "./uploads" });

    await flowDynamic("Déjame leer el recibo… 👀");

    // La IA (ver receipt.service.ts) valida si la imagen es un recibo
    // legible y, si lo es, extrae el consumo.
    const { analysis } = await receiptService.processReceipt(user.id, imagePath);

    // La foto no era una factura de servicios (una comida, un documento
    // cualquiera) o estaba ilegible: no hay consumo que extraer.
    if (!analysis.valid) {
      const intentos = await conversationStateService.registerReceiptAttempt(
        user.id
      );

      await flowDynamic(
        "⚠️ No logramos identificar el consumo, por favor digita el valor en kWh."
      );

      await flowDynamic(
        intentos >= MAX_INTENTOS_FOTO
          ? `${analysis.recommendation ?? "La imagen no parece una factura de energía."}\n\n` +
              "Ya van varios intentos, así que necesito que me lo escribas: envíame *solo el número* de tu consumo promedio en kWh (por ejemplo: 265)."
          : `${analysis.recommendation ?? "La imagen no parece una factura de energía."}\n\n` +
              "También puedes enviarme otra foto, esta vez de la *factura de energía completa*."
      );
      // Nos quedamos en AWAITING_RECEIPT: puede mandar otra foto o el número.
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

    await flowDynamic(`📄 ${consumo}${monto}.`);

    // El promedio de los últimos meses suele estar en un recuadro aparte o en
    // el gráfico del historial, así que es lo primero que se pierde cuando la
    // foto sólo agarra la parte de arriba del recibo.
    if (analysis.averageConsumptionKwh === undefined) {
      const intentos = await conversationStateService.registerReceiptAttempt(
        user.id
      );

      await flowDynamic(
        "⚠️ No logramos identificar el consumo, por favor digita el valor en kWh."
      );

      await flowDynamic(
        intentos >= MAX_INTENTOS_FOTO
          ? "Me falta tu *consumo promedio* de los últimos meses. Escríbeme *solo el número* en kWh (por ejemplo: 265) y seguimos."
          : "Me falta tu *consumo promedio* de los últimos meses, que lo necesito para calcular cuánto puedes bajar.\n\n" +
              "Envíame otra foto donde se vea la *factura completa* — el recuadro o el gráfico del historial de consumo — o escríbeme el número directamente."
      );
      // Seguimos en AWAITING_RECEIPT: puede mandar otra foto o el número.
      return;
    }

    await flowDynamic(
      `Tu promedio de los últimos meses es de *${analysis.averageConsumptionKwh} kWh*.`
    );

    await flowDynamic(
      "Ahora te haré unas preguntas rápidas sobre tus electrodomésticos."
    );

    await conversationStateService.advanceStep(
      user.id,
      ConversationStep.ASKING_AIRE
    );

    return gotoFlow(applianceIntroFlow);
  }
);
