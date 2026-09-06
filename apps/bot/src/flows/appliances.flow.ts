import { addKeyword } from "@builderbot/bot";
import {
  appliancesService,
  conversationStateService,
  ConversationStep,
} from "@energy-bot/services";
import { planFlow } from "./plan.flow.js";
import { isRestartCommand, restartFlow } from "./restart.flow.js";
import { isTextMessage } from "../utils/message-validation.js";
import { sendTemplate } from "../provider/send-template.js";
import {
  APPLIANCE_QUESTIONS,
  type ApplianceQuestion,
  type TextQuestion,
} from "./appliance-questions.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";
import type { TFlow } from "@builderbot/bot/dist/types.js";
import type { ApplianceType } from "@energy-bot/services";

// Clave de state (BuilderBot, en memoria por número — no es la Postgres de
// @energy-bot/database) para cargar la frecuencia del aire de un paso al
// siguiente, hasta que la pregunta de horas la guarda junto con ella en un
// solo Appliance.
const PENDING_FREQUENCY_KEY = "pendingApplianceFrequency";

/**
 * Pregunta de texto libre validada contra `question.validation.pattern`
 * (p.ej. sólo números). Mientras no matchee, se repite el feedback y la
 * pregunta sin avanzar y sin pasar por la IA — eso sólo pasa al final del
 * cuestionario, en el catch-all de welcome.flow.ts. Guarda un solo campo y
 * avanza al siguiente paso.
 */
function buildTextQuestionFlow(options: {
  triggerKeyword: string;
  question: TextQuestion;
  applianceType: ApplianceType;
  nextStep: ConversationStep;
  next: TFlow;
}): TFlow {
  return addKeyword([options.triggerKeyword]).addAnswer(
    options.question.prompt,
    { capture: true },
    async (ctx: FlowContext, { gotoFlow, fallBack }: FlowMethods) => {
      if (isRestartCommand(ctx.body)) {
        return gotoFlow(restartFlow);
      }

      const body = isTextMessage(ctx) ? ctx.body.trim() : "";
      if (!isTextMessage(ctx) || !options.question.validation.pattern.test(body)) {
        return fallBack(options.question.validation.feedback);
      }

      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      await appliancesService.saveApplianceAnswer(user.id, options.applianceType, {
        [options.question.field]: Number(body),
      });
      await conversationStateService.advanceStep(user.id, options.nextStep);
      return gotoFlow(options.next);
    }
  );
}

/**
 * Última pregunta de la cadena lista→horas del aire: guarda la frecuencia
 * que quedó pendiente en `state` (elegida en la lista o en el overflow)
 * junto con esta respuesta, en un solo `Appliance`, y recién ahí avanza.
 */
function buildThenQuestionFlow(options: {
  triggerKeyword: string;
  question: TextQuestion;
  applianceType: ApplianceType;
  nextStep: ConversationStep;
  next: TFlow;
}): TFlow {
  return addKeyword([options.triggerKeyword]).addAnswer(
    options.question.prompt,
    { capture: true },
    async (ctx: FlowContext, { gotoFlow, fallBack, state }: FlowMethods) => {
      if (isRestartCommand(ctx.body)) {
        return gotoFlow(restartFlow);
      }

      const body = isTextMessage(ctx) ? ctx.body.trim() : "";
      if (!isTextMessage(ctx) || !options.question.validation.pattern.test(body)) {
        return fallBack(options.question.validation.feedback);
      }

      const frequencyPerWeek = state.get<number>(PENDING_FREQUENCY_KEY);
      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      await appliancesService.saveApplianceAnswer(user.id, options.applianceType, {
        frequencyPerWeek,
        [options.question.field]: Number(body),
      });
      await conversationStateService.advanceStep(user.id, options.nextStep);
      return gotoFlow(options.next);
    }
  );
}

/**
 * Pregunta libre de "7 o más": pide el número exacto (validado como "mayor
 * o igual a 7"), lo deja pendiente en `state` y sigue a la pregunta de
 * horas — no guarda nada en la base todavía.
 */
function buildOverflowFlow(options: {
  triggerKeyword: string;
  overflow: Extract<ApplianceQuestion["followUp"], { kind: "list" }>["overflow"];
  thenFlow: TFlow;
}): TFlow {
  return addKeyword([options.triggerKeyword]).addAnswer(
    options.overflow.prompt,
    { capture: true },
    async (ctx: FlowContext, { gotoFlow, fallBack, state }: FlowMethods) => {
      if (isRestartCommand(ctx.body)) {
        return gotoFlow(restartFlow);
      }

      const body = isTextMessage(ctx) ? ctx.body.trim() : "";
      if (!isTextMessage(ctx) || !options.overflow.validation.pattern.test(body)) {
        return fallBack(options.overflow.validation.feedback);
      }

      await state.update({ [PENDING_FREQUENCY_KEY]: Number(body) });
      return gotoFlow(options.thenFlow);
    }
  );
}

/**
 * Pregunta con lista de Twilio (sólo el aire). Elegir 1-6 deja
 * esa frecuencia pendiente en `state` y sigue a la pregunta de horas;
 * elegir "7 o más" pasa al overflow, que pide el número exacto. Cualquier
 * otra respuesta reenvía la lista + el feedback
 */
function buildListQuestionFlow(options: {
  triggerKeyword: string;
  question: Extract<ApplianceQuestion["followUp"], { kind: "list" }>;
  overflowFlow: TFlow;
  thenFlow: TFlow;
}): TFlow {
  return addKeyword([options.triggerKeyword])
    .addAction(async (ctx: FlowContext, { provider }: FlowMethods) => {
      await sendTemplate(provider, ctx.from, options.question.template);
    })
    .addAction(
      { capture: true },
      async (ctx: FlowContext, { gotoFlow, fallBack, provider, state }: FlowMethods) => {
        if (isRestartCommand(ctx.body)) {
          return gotoFlow(restartFlow);
        }

        const body = isTextMessage(ctx) ? ctx.body.trim() : "";

        if (isTextMessage(ctx) && options.question.overflow.pattern.test(body)) {
          return gotoFlow(options.overflowFlow);
        }

        if (!isTextMessage(ctx) || !options.question.validation.pattern.test(body)) {
          await sendTemplate(provider, ctx.from, options.question.template);
          return fallBack(options.question.validation.feedback);
        }

        await state.update({ [PENDING_FREQUENCY_KEY]: Number(body) });
        return gotoFlow(options.thenFlow);
      }
    );
}

/**
 * Pregunta sí/no con plantilla de Twilio. "No" salta la pregunta de
 * frecuencia/uso y no guarda ningún `Appliance`; "Sí" pasa al follow-up.
 * Cualquier otra respuesta repite la plantilla + el feedback
 */
function buildGateFlow(options: {
  triggerKeyword: string;
  gate: ApplianceQuestion["gate"];
  nextStep: ConversationStep;
  next: TFlow;
  followUpFlow: TFlow;
}): TFlow {
  return addKeyword([options.triggerKeyword])
    .addAction(async (ctx: FlowContext, { provider }: FlowMethods) => {
      await sendTemplate(provider, ctx.from, options.gate.template);
    })
    .addAction(
      { capture: true },
      async (ctx: FlowContext, { gotoFlow, fallBack, provider }: FlowMethods) => {
        if (isRestartCommand(ctx.body)) {
          return gotoFlow(restartFlow);
        }

        const body = isTextMessage(ctx) ? ctx.body.trim() : "";

        if (isTextMessage(ctx) && options.gate.no.test(body)) {
          const { user } = await conversationStateService.getOrCreateSession(ctx.from);
          await conversationStateService.advanceStep(user.id, options.nextStep);
          return gotoFlow(options.next);
        }

        if (isTextMessage(ctx) && options.gate.yes.test(body)) {
          return gotoFlow(options.followUpFlow);
        }

        await sendTemplate(provider, ctx.from, options.gate.template);
        return fallBack(options.gate.feedback);
      }
    );
}

interface BuiltAppliance {
  gateFlow: TFlow;
  flows: TFlow[];
}

// Se construyen en orden inverso de dependencia: cada paso necesita conocer
// el flow al que saltar (y el ConversationStep al que avanzar) cuando
// termina o cuando la respuesta es "No". `built[0]` es siempre el resultado
// de la pregunta siguiente en APPLIANCE_QUESTIONS (o vacío para la última).
const built: BuiltAppliance[] = [];

for (let i = APPLIANCE_QUESTIONS.length - 1; i >= 0; i--) {
  const question = APPLIANCE_QUESTIONS[i];
  const nextStep = APPLIANCE_QUESTIONS[i + 1]?.step ?? ConversationStep.COMPLETED;
  const nextFlow = built[0]?.gateFlow ?? planFlow;

  let followUpFlow: TFlow;
  const extraFlows: TFlow[] = [];

  if (question.followUp.kind === "text") {
    followUpFlow = buildTextQuestionFlow({
      triggerKeyword: `_ask_${question.key}_followup_`,
      question: question.followUp,
      applianceType: question.applianceType,
      nextStep,
      next: nextFlow,
    });
  } else {
    const thenFlow = buildThenQuestionFlow({
      triggerKeyword: `_ask_${question.key}_then_`,
      question: question.followUp.then,
      applianceType: question.applianceType,
      nextStep,
      next: nextFlow,
    });
    extraFlows.push(thenFlow);

    const overflowFlow = buildOverflowFlow({
      triggerKeyword: `_ask_${question.key}_overflow_`,
      overflow: question.followUp.overflow,
      thenFlow,
    });
    extraFlows.push(overflowFlow);

    followUpFlow = buildListQuestionFlow({
      triggerKeyword: `_ask_${question.key}_followup_`,
      question: question.followUp,
      overflowFlow,
      thenFlow,
    });
  }

  const gateFlow = buildGateFlow({
    triggerKeyword: `_ask_${question.key}_`,
    gate: question.gate,
    nextStep,
    next: nextFlow,
    followUpFlow,
  });

  built.unshift({ gateFlow, flows: [gateFlow, followUpFlow, ...extraFlows] });
}


export const applianceIntroFlow = addKeyword(["_applianceQuestionsFlow_"])
  .addAnswer(
    "Antes de seguir: esta información sobre tus electrodomésticos la uso solo para " +
      "estimar tu consumo y tu plan de ahorro. 📋"
  )
  .addAction(async (_ctx: FlowContext, { gotoFlow }: FlowMethods) => {
    return gotoFlow(built[0].gateFlow);
  });

// Todos los flows que este archivo define deben registrarse en createFlow()
// (apps/bot/src/index.ts) para que gotoFlow pueda saltar entre ellos.
export const applianceFlows: TFlow[] = [
  applianceIntroFlow,
  ...built.flatMap((b) => b.flows),
];
