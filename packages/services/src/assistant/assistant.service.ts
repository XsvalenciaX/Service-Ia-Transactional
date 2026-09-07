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
import {
  calculateTargetKwh,
  getMonthlyPlanStatus,
  PROMISED_REDUCTION_PERCENT,
  type MonthlyPlanStatus,
} from "../plan/plan.service.js";

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
  [ConversationStep.WELCOME]: "Apenas empieza la conversación.",
  [ConversationStep.AWAITING_RECEIPT]:
    "Estás esperando la foto de su recibo de luz o el consumo promedio en kWh escrito a mano: recuérdaselo al final de tu respuesta.",
  [ConversationStep.ASKING_AIRE]:
    "Estás en medio de las preguntas sobre electrodomésticos (aire acondicionado).",
  [ConversationStep.ASKING_PLANCHA]:
    "Estás en medio de las preguntas sobre electrodomésticos (plancha).",
  [ConversationStep.ASKING_HORNO]:
    "Estás en medio de las preguntas sobre electrodomésticos (horno / air fryer).",
  [ConversationStep.COMPLETED]:
    "Ya le entregaste su plan de ahorro: puede preguntarte lo que quiera sobre él.",
};

const ASSISTANT_SYSTEM = `Eres el asistente de un bot de WhatsApp colombiano que ayuda
a reducir el consumo eléctrico del hogar o del comercio. Te llega un mensaje del
usuario que no era la respuesta que el bot estaba esperando, y tienes que decidir qué
hacer con él.

Contestas SOLO sobre: ahorro y consumo de energía eléctrica, la factura de luz del
usuario, sus electrodomésticos y hábitos de uso, el plan de ahorro que le armaste, y
cómo funciona este bot.

Entra todo lo que tenga que ver con la luz, aunque no sea sobre los datos puntuales
del usuario: cómo se lee una factura, qué son los estratos, qué electrodoméstico
gasta más, cómo se mide el consumo, por qué pudo subirle el consumo de un mes a otro.
Ante la duda de si una pregunta es del tema, asume que sí.
Queda afuera lo que no tiene nada que ver: deportes, política, chistes, recetas,
otros servicios (agua, gas, internet), consultas personales.

Devuelves JSON con esta forma exacta:
{
  "onTopic": boolean,  // true si la pregunta entra en los temas de arriba
  "reply": string      // lo que se le manda al usuario por WhatsApp
}

Si onTopic es true:
- Responde usando los datos concretos del usuario que te paso abajo (su consumo, sus
  electrodomésticos, su plan). Si te preguntan algo de energía que no depende de sus
  datos, respóndelo igual con lo que sabes.
- NUNCA hables de dinero: ni precios, ni tarifas, ni pesos, ni cuánto vale el kWh, ni
  cuánto cuesta prender algo, ni cuánto se ahorra en la factura. Todo lo mides en kWh
  o en porcentaje de consumo. Este bot habla de energía, no de plata.
- Si te preguntan justamente por un precio, una tarifa o cuánto va a pagar: eso sigue
  siendo onTopic true, pero no des ninguna cifra de dinero. Di en una frase que de
  precios no te encargas y reconduce a lo que sí sabes — cuántos kWh gasta ese
  electrodoméstico, cuánto puede bajar su consumo, qué dice su plan.
- Sé breve: dos o tres frases, es un chat de WhatsApp.
- Si no tienes el dato que te piden (todavía no ha mandado el recibo, por ejemplo),
  dilo y pídeselo.

Si onTopic es false:
- Dile con amabilidad que de eso no puedes ayudarle, y vuelve a encarrilar la
  conversación hacia lo que sí haces, proponiéndole algo concreto de sus datos.
  Nunca respondas la pregunta que te hicieron, ni siquiera en parte.
- No arranques con muletillas de relleno ("jaja", "uy"): entra directo, y varía la
  forma de abrir cada vez.

Escribe en español colombiano neutro, tratando al usuario de "tú", sin markdown y sin
emojis al principio. Nunca uses insultos ni apodos, ni siquiera en broma o si el
usuario te provoca, y evita modismos de otros países (nada de "boludo", "che",
"vale", "güey").`;

/**
 * El plan se guarda con el porcentaje que se le pidió a la IA
 * (PLAN_REDUCTION_PERCENT, 15%), pero al usuario se le prometió
 * PROMISED_REDUCTION_PERCENT (10%). Si el asistente ve el 15% guardado se lo
 * repite y le contradice el mensaje que ya leyó, así que se lo cambiamos por
 * el que corresponde antes de mandárselo.
 */
function buildPlanForAssistant(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return {};
  }

  const { targetReductionPercent, ...resto } = content as Record<string, unknown>;
  return { ...resto, targetReductionPercent: PROMISED_REDUCTION_PERCENT };
}

function readAverageConsumptionKwh(receipt: Receipt | null): number | undefined {
  const data = receipt?.extractedData;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const valor = (data as Record<string, unknown>).averageConsumptionKwh;
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

function buildUserContext(
  receipt: Receipt | null,
  appliances: Appliance[],
  plan: SavingsPlan | null,
  step: ConversationStep,
  monthly: MonthlyPlanStatus
): string {
  const partes: string[] = [`Situación: ${STEP_HINTS[step]}`];

  partes.push(
    receipt?.extractedData
      ? `Datos de su última factura: ${JSON.stringify(receipt.extractedData)}`
      : "Todavía no ha enviado el recibo, así que no conoces su consumo."
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
      : "Todavía no ha contestado las preguntas sobre sus electrodomésticos."
  );

  partes.push(
    plan?.content
      ? `Plan que ya le entregaste: ${JSON.stringify(
          buildPlanForAssistant(plan.content)
        )}`
      : "Todavía no tiene un plan generado."
  );

  // La meta que el usuario vio es la prometida, no la que se le pidió a la IA.
  const promedio = readAverageConsumptionKwh(receipt);
  partes.push(
    promedio !== undefined
      ? `Meta que le prometiste: bajar ${PROMISED_REDUCTION_PERCENT}% su consumo,` +
          ` hasta ${calculateTargetKwh(promedio)} kWh o menos en la próxima factura.` +
          " Es la única cifra de meta que puedes nombrar."
      : `Meta que le prometiste: bajar ${PROMISED_REDUCTION_PERCENT}% su consumo.` +
          " Es la única cifra de meta que puedes nombrar."
  );

  // Sin esto el modelo inventa el mes: llegó a decir "el próximo plan es en
  // septiembre" estando en septiembre.
  const hoy = new Date();
  const mesSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
  const nombreMes = (fecha: Date) =>
    fecha.toLocaleDateString("es-CO", { month: "long", year: "numeric" });

  partes.push(
    `Hoy es ${hoy.toLocaleDateString("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}. El mes en curso es ${nombreMes(hoy)} y el siguiente es ${nombreMes(
      mesSiguiente
    )}.`
  );

  partes.push(
    monthly.alreadyDoneThisMonth
      ? "El plan se arma una vez al mes y el suyo ya está hecho este mes. Si te pide" +
          ` uno nuevo, explícale que lo actualizan en ${nombreMes(mesSiguiente)},` +
          " cuando le llegue la próxima factura, y que ahí te mande la foto." +
          " No inventes otra fecha."
      : "Si te pide armar o actualizar su plan, pídele la foto de su factura más" +
          " reciente: todavía no tiene el plan de este mes."
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
  const [receipt, appliances, plan, monthly] = await Promise.all([
    receiptRepository.findLatestByUserId(userId),
    applianceRepository.findAllByUserId(userId),
    planRepository.findLatestByUserId(userId),
    getMonthlyPlanStatus(userId),
  ]);

  const context = buildUserContext(receipt, appliances, plan, step, monthly);

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
          "En este momento no puedo responderte eso. Intenta de nuevo en un rato.",
      };
    }
    throw error;
  }
}
