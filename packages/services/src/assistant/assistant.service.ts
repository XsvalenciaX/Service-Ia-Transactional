import {
  receiptRepository,
  applianceRepository,
  planRepository,
  ApplianceType,
  ConversationStep,
  type Appliance,
  type Receipt,
  type SavingsPlan,
} from "@energy-bot/database";
import { AiError, requestJson } from "../shared/ai.js";

export interface AssistantAnswer {
  /** false cuando la pregunta no tenía nada que ver con energía. */
  onTopic: boolean;
  /** Lo que hay que mandarle al usuario, ya redactado. */
  reply: string;
}

const APPLIANCE_LABELS: Record<ApplianceType, string> = {
  [ApplianceType.AIRE]: "aire acondicionado",
  [ApplianceType.PLANCHA]: "plancha",
  [ApplianceType.HORNO_AIRFRYER]: "horno eléctrico / air fryer",
};

const STEP_HINTS: Record<ConversationStep, string> = {
  [ConversationStep.WELCOME]: "Recién arranca la conversación.",
  [ConversationStep.AWAITING_RECEIPT]:
    "Estás esperando que te mande la foto de su recibo de luz: recordáselo al final de tu respuesta.",
  [ConversationStep.ASKING_AIRE]:
    "Estás en medio de las preguntas sobre electrodomésticos (aire acondicionado).",
  [ConversationStep.ASKING_PLANCHA]:
    "Estás en medio de las preguntas sobre electrodomésticos (plancha).",
  [ConversationStep.ASKING_HORNO]:
    "Estás en medio de las preguntas sobre electrodomésticos (horno / air fryer).",
  [ConversationStep.COMPLETED]:
    "Ya le entregaste su plan de ahorro: puede preguntarte lo que quiera sobre él.",
};

const ASSISTANT_SYSTEM = `Sos el asistente de un bot de WhatsApp que ayuda a bajar un 15%
el consumo eléctrico del hogar. Te llega un mensaje del usuario que no era la respuesta
que el bot estaba esperando, y tenés que decidir qué hacer con él.

Contestás SOLO sobre: ahorro y consumo de energía eléctrica, la factura de luz del
usuario, sus electrodomésticos y hábitos de uso, el plan de ahorro que le armaste, y
cómo funciona este bot.

Entra todo lo que tenga que ver con la luz, aunque no sea sobre los datos puntuales
del usuario: cuánto cuesta el kWh, cómo se lee una factura, qué son los estratos,
qué electrodoméstico gasta más, por qué subió la tarifa, cómo se mide el consumo.
Ante la duda de si una pregunta es del tema, asumí que sí.
Queda afuera lo que no tiene nada que ver: deportes, política, chistes, recetas,
otros servicios (agua, gas, internet), consultas personales.

Devolvés JSON con esta forma exacta:
{
  "onTopic": boolean,  // true si la pregunta entra en los temas de arriba
  "reply": string      // lo que se le manda al usuario por WhatsApp
}

Si onTopic es true:
- Respondé usando los datos concretos del usuario que te paso abajo (su consumo, sus
  electrodomésticos, su plan). Si te preguntan algo de energía que no depende de sus
  datos, respondelo igual con lo que sabés.
- Sé breve: dos o tres frases, es un chat de WhatsApp.
- Si no tenés el dato que te piden (todavía no mandó el recibo, por ejemplo), decilo
  y pedíselo.

Si onTopic es false:
- Decile con amabilidad y buena onda que de eso no podés ayudarlo, y volvé a
  encarrilar la conversación hacia lo que sí hacés, proponiéndole algo concreto de
  sus datos. Nunca respondas la pregunta que te hicieron, ni siquiera en parte.
- No arranques con muletillas de relleno ("jaja", "uy", "che"): entrá directo, y
  variá la forma de abrir cada vez.

Escribí en español rioplatense, tuteando, sin markdown y sin emojis al principio.`;

function buildUserContext(
  receipt: Receipt | null,
  appliances: Appliance[],
  plan: SavingsPlan | null,
  step: ConversationStep
): string {
  const partes: string[] = [`Situación: ${STEP_HINTS[step]}`];

  partes.push(
    receipt?.extractedData
      ? `Datos de su última factura: ${JSON.stringify(receipt.extractedData)}`
      : "Todavía no mandó el recibo, así que no sabés su consumo."
  );

  partes.push(
    appliances.length > 0
      ? `Electrodomésticos que declaró:\n${appliances
          .map(
            (a) =>
              `- ${APPLIANCE_LABELS[a.type]}: ${
                a.usageNote ?? "sin detalle"
              } (${a.frequencyPerWeek ?? "?"} veces por semana)`
          )
          .join("\n")}`
      : "Todavía no contestó las preguntas sobre sus electrodomésticos."
  );

  partes.push(
    plan?.content
      ? `Plan que ya le entregaste: ${JSON.stringify(plan.content)}`
      : "Todavía no tiene un plan generado."
  );

  return partes.join("\n\n");
}

/**
 * Responde un mensaje que se salió del guion. Si es del tema, contesta con los
 * datos del propio usuario; si no, devuelve una negativa amable escrita por el
 * modelo (para que no sea siempre la misma frase) sin contestar lo preguntado.
 */
export async function answerQuestion(
  userId: string,
  question: string,
  step: ConversationStep
): Promise<AssistantAnswer> {
  const [receipt, appliances, plan] = await Promise.all([
    receiptRepository.findLatestByUserId(userId),
    applianceRepository.findAllByUserId(userId),
    planRepository.findLatestByUserId(userId),
  ]);

  const context = buildUserContext(receipt, appliances, plan, step);

  try {
    return await requestJson<AssistantAnswer>({
      system: ASSISTANT_SYSTEM,
      prompt: `${context}\n\nMensaje del usuario:\n"""${question}"""`,
      maxTokens: 1024,
    });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[assistant] no pude responder la consulta:", error.message);
      return {
        onTopic: false,
        reply:
          "Uy, ahora mismo no te puedo responder eso. Probá de nuevo en un ratito.",
      };
    }
    throw error;
  }
}
