import { addKeyword } from "@builderbot/bot";
import {
  appliancesService,
  conversationStateService,
  ConversationStep,
} from "@energy-bot/services";
import { planFlow } from "./plan.flow.js";
import { isTextMessage } from "../utils/message-validation.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";
import type { TFlow } from "@builderbot/bot/dist/types.js";

function extractFrequency(text: string): number | undefined {
  const match = new RegExp(/\d+/).exec(text);
  return match ? Number(match[0]) : undefined;
}

// Heurística simple (no es IA): si el usuario empieza su respuesta con "no",
// asumimos que no tiene el electrodoméstico. Cualquier otra cosa (el botón
// "Sí", "sí", "claro", "tengo uno"...) se trata como afirmativa.
function isNegative(text: string): boolean {
  return /^no\b/i.test(text.trim());
}

/**
 * Crea el par de flujos (pregunta sí/no + pregunta de frecuencia) para un
 * electrodoméstico. Si el usuario responde "No", nos saltamos la pregunta de
 * frecuencia y no se guarda ningún `Appliance`; si responde afirmativo,
 * pasamos a pedir la frecuencia/horas de uso y ahí sí se guarda.
 */
function buildApplianceStep(options: {
  triggerKeyword: string;
  applianceType: appliancesService.ApplianceType;
  yesNoQuestion: string;
  frequencyQuestion: string;
  nextConversationStep: ConversationStep;
  next: TFlow;
}) {
  const frequencyFlow = addKeyword([`${options.triggerKeyword}_frequency`]).addAnswer(
    options.frequencyQuestion,
    { capture: true },
    async (ctx: FlowContext, { gotoFlow, fallBack }: FlowMethods) => {
      if (!isTextMessage(ctx)) {
        return fallBack("Necesito que me respondas con un mensaje de *texto*, por favor 🙏");
      }

      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      await appliancesService.saveApplianceAnswer(user.id, options.applianceType, {
        frequencyPerWeek: extractFrequency(ctx.body),
        usageNote: ctx.body,
      });
      await conversationStateService.advanceStep(user.id, options.nextConversationStep);
      return gotoFlow(options.next);
    }
  );

  const gateFlow = addKeyword([options.triggerKeyword]).addAnswer(
    options.yesNoQuestion,
    { capture: true, buttons: [{ body: "Sí" }, { body: "No" }] },
    async (ctx: FlowContext, { gotoFlow, fallBack }: FlowMethods) => {
      if (!isTextMessage(ctx)) {
        return fallBack("Necesito que me respondas con un mensaje de *texto*, por favor 🙏");
      }

      if (isNegative(ctx.body)) {
        const { user } = await conversationStateService.getOrCreateSession(ctx.from);
        await conversationStateService.advanceStep(user.id, options.nextConversationStep);
        return gotoFlow(options.next);
      }
      return gotoFlow(frequencyFlow);
    }
  );

  return { gateFlow, frequencyFlow };
}

// Se construyen en orden inverso de dependencia: cada paso necesita conocer
// el flujo al que saltar cuando termina (o cuando la respuesta es "No").
const horno = buildApplianceStep({
  triggerKeyword: "_ask_horno_",
  applianceType: appliancesService.ApplianceType.HORNO_AIRFRYER,
  yesNoQuestion:
    "🍟 ¿Tienes *horno eléctrico* o *freidora de aire (air fryer)*?",
  frequencyQuestion: "¿Cuántas veces a la semana lo usas?",
  nextConversationStep: ConversationStep.COMPLETED,
  next: planFlow,
});

const plancha = buildApplianceStep({
  triggerKeyword: "_ask_plancha_",
  applianceType: appliancesService.ApplianceType.PLANCHA,
  yesNoQuestion: "👕 ¿Tienes *plancha*?",
  frequencyQuestion: "¿Cuántas veces a la semana la usas?",
  nextConversationStep: ConversationStep.ASKING_HORNO,
  next: horno.gateFlow,
});

const aire = buildApplianceStep({
  triggerKeyword: "_ask_aire_",
  applianceType: appliancesService.ApplianceType.AIRE,
  yesNoQuestion: "❄️ ¿Tienes *aire acondicionado*?",
  frequencyQuestion:
    'Cuéntame cuántas veces a la semana lo usas y cuántas horas aproximadamente (ej: "3 veces, 2 horas").',
  nextConversationStep: ConversationStep.ASKING_PLANCHA,
  next: plancha.gateFlow,
});

// Entrado únicamente vía gotoFlow desde receipt.flow.ts, nunca por keyword directa del usuario.
export const applianceIntroFlow = addKeyword(["_applianceQuestionsFlow_"])
  .addAnswer(
    "Antes de seguir: esta información sobre tus electrodomésticos la uso solo para " +
      "estimar tu consumo y es necesaria para armar tu plan de ahorro. 📋"
  )
  .addAction(async (ctx: FlowContext, { gotoFlow }: FlowMethods) => {
    return gotoFlow(aire.gateFlow);
  });

// Todos los flujos que este archivo define deben registrarse en createFlow()
// (apps/bot/src/index.ts) para que gotoFlow pueda saltar entre ellos.
export const applianceFlows: TFlow[] = [
  applianceIntroFlow,
  aire.gateFlow,
  aire.frequencyFlow,
  plancha.gateFlow,
  plancha.frequencyFlow,
  horno.gateFlow,
  horno.frequencyFlow,
];
