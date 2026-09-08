import { addKeyword } from "@builderbot/bot";
import {
  appliancesService,
  conversationStateService,
  ConversationStep,
  APPLIANCE_QUESTIONS,
  type ApplianceQuestion,
  type TextQuestion,
 ApplianceType } from "@energy-bot/services";
import { planFlow } from "./plan.flow.js";
import { isRestartCommand, restartFlow } from "./restart.flow.js";
import { isTextMessage, readInteractiveData } from "../utils/message-validation.js";
import { sendTemplate } from "../provider/send-template.js";
import type { FlowContext, FlowMethods } from "../types/flow.js";
import type { TFlow } from "@builderbot/bot/dist/types.js";

// Clave de state (BuilderBot, en memoria por número — no es la Postgres de
// @energy-bot/database) para cargar la frecuencia/cantidad de un paso al
// siguiente, hasta que la pregunta de horas la guarda junto con ella en un
// solo Appliance (sólo lo usan los followUp tipo "list", como el del aire).
const PENDING_FREQUENCY_KEY = "pendingApplianceFrequency";

// Cola de `key`s (de APPLIANCE_QUESTIONS) que el usuario marcó en
// "appliance_selection" y todavía no contestó su followUp. El primero de
// la lista es siempre el que está activo; cada followUp, al terminar, la
// achica y salta al siguiente (ver advanceToNextAppliance).
const PENDING_APPLIANCE_KEYS = "pendingApplianceKeys";

// Horas/día pendientes de un followUp tipo "list" que además tiene `extra`
// (hoy sólo el aire, con la pregunta de temperatura): se guardan acá hasta
// que la pregunta de `extra` las junta con frecuencia + extra en un solo
// Appliance.
const PENDING_HOURS_KEY = "pendingApplianceHours";

const APPLIANCE_SELECTION_CONTENT_SID = "HXc523c1fed19933718c26fc3e6bd606e1";

const questionsByKey = new Map(APPLIANCE_QUESTIONS.map((q) => [q.key, q]));

/**
 * Después de guardar la respuesta de un electrodoméstico, saca el primero
 * de la cola de pendientes (el que se acaba de contestar) y salta al
 * followUp del que quedó primero. Vacía la cola -> ya se preguntó todo lo
 * que el usuario marcó, sigue a planFlow.
 */
async function advanceToNextAppliance(
  userId: string,
  state: FlowMethods["state"],
  gotoFlow: FlowMethods["gotoFlow"]
) {
  const remaining = (state.get<string[]>(PENDING_APPLIANCE_KEYS) ?? []).slice(1);
  await state.update({ [PENDING_APPLIANCE_KEYS]: remaining });

  const nextKey = remaining[0];
  if (!nextKey) {
    await conversationStateService.advanceStep(userId, ConversationStep.COMPLETED);
    return gotoFlow(planFlow);
  }

  const nextQuestion = questionsByKey.get(nextKey);
  const nextFlow = followUpFlowByKey.get(nextKey);
  await conversationStateService.advanceStep(userId, nextQuestion!.step);
  return gotoFlow(nextFlow!);
}

/**
 * Pregunta de texto libre validada contra `question.validation.pattern`
 * (p.ej. sólo números). Mientras no matchee, se repite el feedback y la
 * pregunta sin avanzar y sin pasar por la IA — eso sólo pasa al final del
 * cuestionario, en el catch-all de welcome.flow.ts. Guarda un solo campo y
 * sigue con el próximo electrodoméstico pendiente.
 */
function buildTextQuestionFlow(options: {
  triggerKeyword: string;
  question: TextQuestion;
  applianceType: ApplianceType;
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

      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      await appliancesService.saveApplianceAnswer(user.id, options.applianceType, {
        [options.question.field]: Number(body),
      });
      return advanceToNextAppliance(user.id, state, gotoFlow);
    }
  );
}

/**
 * Última pregunta de la cadena lista→horas (aire, tv, ventilador): guarda
 * la cantidad que quedó pendiente en `state` (elegida en la lista o en el
 * overflow) junto con esta respuesta, en un solo `Appliance`, y recién ahí
 * sigue con el próximo electrodoméstico pendiente.
 *
 * Si el followUp tiene una pregunta `extra` (hoy sólo el aire, temperatura),
 * en vez de guardar acá deja las horas pendientes en `state` y salta a
 * `extraFlow`, que es quien junta todo y guarda.
 */
function buildThenQuestionFlow(options: {
  triggerKeyword: string;
  question: TextQuestion;
  applianceType: ApplianceType;
  extraFlow?: TFlow;
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

      if (options.extraFlow) {
        await state.update({ [PENDING_HOURS_KEY]: Number(body) });
        return gotoFlow(options.extraFlow);
      }

      const frequencyPerWeek = state.get<number>(PENDING_FREQUENCY_KEY);
      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      await appliancesService.saveApplianceAnswer(user.id, options.applianceType, {
        frequencyPerWeek,
        [options.question.field]: Number(body),
      });
      return advanceToNextAppliance(user.id, state, gotoFlow);
    }
  );
}

/**
 * Pregunta `extra` de la cadena lista→horas→extra (hoy sólo el aire,
 * temperatura): junta la cantidad y las horas que quedaron pendientes en
 * `state` con esta respuesta, guarda el `Appliance` completo, y sigue con
 * el próximo electrodoméstico pendiente.
 */
function buildExtraQuestionFlow(options: {
  triggerKeyword: string;
  question: TextQuestion;
  applianceType: ApplianceType;
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
      const hoursPerDay = state.get<number>(PENDING_HOURS_KEY);
      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      await appliancesService.saveApplianceAnswer(user.id, options.applianceType, {
        frequencyPerWeek,
        hoursPerDay,
        [options.question.field]: Number(body),
      });
      return advanceToNextAppliance(user.id, state, gotoFlow);
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
 * Pregunta con lista de Twilio (aire, tv, ventilador). Elegir 1-6 deja esa
 * cantidad pendiente en `state` y sigue a la pregunta de horas; elegir "7
 * o más" pasa al overflow, que pide el número exacto. Cualquier otra
 * respuesta reenvía la lista + el feedback.
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

// Se arma un followUp por cada entrada de APPLIANCE_QUESTIONS (ya no hay
// cadena de dependencia entre ellos como con el viejo gate por aparato: el
// orden en que se preguntan ahora lo decide la selección del usuario en
// "appliance_selection", no la posición en este array).
const followUpFlowByKey = new Map<string, TFlow>();
const followUpFlows: TFlow[] = [];

for (const question of APPLIANCE_QUESTIONS) {
  let followUpFlow: TFlow;

  if (question.followUp.kind === "text") {
    followUpFlow = buildTextQuestionFlow({
      triggerKeyword: `_ask_${question.key}_followup_`,
      question: question.followUp,
      applianceType: question.applianceType,
    });
    followUpFlows.push(followUpFlow);
  } else {
    const listFollowUp = question.followUp;
    const extraFlow = listFollowUp.extra
      ? buildExtraQuestionFlow({
          triggerKeyword: `_ask_${question.key}_extra_`,
          question: listFollowUp.extra,
          applianceType: question.applianceType,
        })
      : undefined;
    const thenFlow = buildThenQuestionFlow({
      triggerKeyword: `_ask_${question.key}_then_`,
      question: listFollowUp.then,
      applianceType: question.applianceType,
      extraFlow,
    });
    const overflowFlow = buildOverflowFlow({
      triggerKeyword: `_ask_${question.key}_overflow_`,
      overflow: listFollowUp.overflow,
      thenFlow,
    });
    followUpFlow = buildListQuestionFlow({
      triggerKeyword: `_ask_${question.key}_followup_`,
      question: listFollowUp,
      overflowFlow,
      thenFlow,
    });
    followUpFlows.push(followUpFlow, overflowFlow, thenFlow);
    if (extraFlow) {
      followUpFlows.push(extraFlow);
    }
  }

  followUpFlowByKey.set(question.key, followUpFlow);
}

/**
 * De InteractiveData (respuesta real de "appliance_selection") saca los
 * `id` marcados, sin importar en qué página estén, y los devuelve en el
 * orden canónico de APPLIANCE_QUESTIONS. Forma confirmada contra un
 * webhook real:
 *
 * { "pages": [
 *     { "pageId": "climatizacion", "items": [{ "label": "climatizacion", "value": ["aire"] }] },
 *     { "pageId": "cuidado_personal", "items": null }
 * ] }
 *
 * `items` es `null` cuando no se marcó nada en esa página. `label` en cada
 * item es en realidad el `name` del componente (no el texto de la
 * pregunta) -- no se usa para nada, sólo `value` importa acá.
 */
function parseSelectedKeysFromInteractiveData(data: Record<string, unknown>): string[] {
  const selected = new Set<string>();
  const pages = Array.isArray(data.pages) ? data.pages : [];

  for (const page of pages) {
    const items = Array.isArray((page as { items?: unknown })?.items)
      ? (page as { items: unknown[] }).items
      : [];

    for (const item of items) {
      const values = Array.isArray((item as { value?: unknown })?.value)
        ? (item as { value: unknown[] }).value
        : [];

      for (const id of values) {
        if (typeof id === "string" && questionsByKey.has(id)) {
          selected.add(id);
        }
      }
    }
  }

  return APPLIANCE_QUESTIONS.filter((q) => selected.has(q.key)).map((q) => q.key);
}

const SELECTION_FALLBACK_TEXT =
  "Para continuar, elige de la lista qué electrodomésticos tienes en tu hogar.";

/**
 * Pantalla de selección múltiple de Twilio (appliance_selection, ver
 * scripts/create-appliance-selection-content.mjs): reemplaza el viejo
 * yes/no uno por electrodoméstico por una sola pregunta. Guarda la
 * selección como cola en `state` y arranca el followUp del primero.
 *
 * Sólo se acepta la respuesta real del select (InteractiveData) -- si el
 * usuario escribe texto en vez de tocar la lista (incluido "ninguno"), se
 * le pide que use la lista y se le reenvía, sin intentar interpretar lo
 * que escribió. Esto deja sin forma de probar este paso en el simulador
 * (WebProvider no genera InteractiveData) hasta que se le agregue esa
 * simulación.
 */
const applianceSelectionFlow = addKeyword(["_ask_appliance_selection_"])
  .addAction(async (ctx: FlowContext, { provider }: FlowMethods) => {
    await sendTemplate(provider, ctx.from, {
      contentSid: APPLIANCE_SELECTION_CONTENT_SID,
      fallbackText: SELECTION_FALLBACK_TEXT,
    });
  })
  .addAction(
    { capture: true },
    async (ctx: FlowContext, { gotoFlow, fallBack, provider, state }: FlowMethods) => {
      if (isTextMessage(ctx) && isRestartCommand(ctx.body)) {
        return gotoFlow(restartFlow);
      }

      const { user } = await conversationStateService.getOrCreateSession(ctx.from);
      const interactiveData = readInteractiveData(ctx);

      if (!interactiveData) {
        await sendTemplate(provider, ctx.from, {
          contentSid: APPLIANCE_SELECTION_CONTENT_SID,
          fallbackText: SELECTION_FALLBACK_TEXT,
        });
        return fallBack("Necesito que elijas de la lista de arriba 📋");
      }

      const selectedKeys = parseSelectedKeysFromInteractiveData(interactiveData);

      await state.update({ [PENDING_APPLIANCE_KEYS]: selectedKeys });

      const firstKey = selectedKeys[0];
      if (!firstKey) {
        await conversationStateService.advanceStep(user.id, ConversationStep.COMPLETED);
        return gotoFlow(planFlow);
      }

      const firstQuestion = questionsByKey.get(firstKey)!;
      await conversationStateService.advanceStep(user.id, firstQuestion.step);
      return gotoFlow(followUpFlowByKey.get(firstKey)!);
    }
  );

export const applianceIntroFlow = addKeyword(["_applianceQuestionsFlow_"])
  .addAnswer(
    "Esta información sobre tus electrodomésticos la uso solo para calcular tu plan " +
      "de ahorro, nada más. 🔒"
  )
  .addAction(async (_ctx: FlowContext, { gotoFlow }: FlowMethods) => {
    return gotoFlow(applianceSelectionFlow);
  });

// Todos los flows que este archivo define deben registrarse en createFlow()
// (apps/bot/src/index.ts) para que gotoFlow pueda saltar entre ellos.
export const applianceFlows: TFlow[] = [
  applianceIntroFlow,
  applianceSelectionFlow,
  ...followUpFlows,
];
