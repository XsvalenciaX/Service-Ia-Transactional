import {
  receiptRepository,
  applianceRepository,
  planRepository,
  PlanStatus,
  ApplianceType,
  type SavingsPlan,
  type Receipt,
  type Appliance,
} from "@energy-bot/database";
import {
  guessImageMediaType,
  readImageAsBase64,
  type ImageMediaType,
} from "../shared/image.js";
import { AiError, requestJson } from "../shared/ai.js";

export interface SavingsPlanContent {
  targetReductionPercent: number;
  summary: string;
  recommendations: string[];
}

export interface PlanGenerationRequest {
  image?: { mediaType: ImageMediaType; base64: string };
  context: string;
  instructions: string;
}

const PLAN_SYSTEM = `Eres un asesor de eficiencia energética colombiano que le arma a
un usuario de WhatsApp un plan para reducir un 15% su consumo eléctrico.

Trabajas con dos insumos: los datos del recibo de luz del usuario y las respuestas
que dio sobre cómo usa sus electrodomésticos. Reglas:
- Basa cada recomendación en esos datos concretos: menciona el electrodoméstico y la
  frecuencia que el usuario declaró, y cuando tengas el consumo o el monto del
  recibo, úsalos para dimensionar el ahorro.
- Si tienes el consumo promedio de los últimos meses (averageConsumptionKwh), úsalo
  como referencia: calcula el 15% sobre ese promedio y comenta si el mes facturado
  estuvo por encima o por debajo de lo habitual. Si no lo tienes, trabaja con el
  consumo del período y no lo menciones.
- Si el usuario dijo que no tiene un electrodoméstico, no lo recomiendes.
- Entre 3 y 5 recomendaciones, cada una accionable y en una o dos frases.
- Escribe en español colombiano neutro, tratando al usuario de "tú", sin tecnicismos
  ni markdown. Nada de insultos ni de modismos de otros países.
- Responde únicamente con el JSON pedido.`;

const APPLIANCE_QUESTIONS: Record<ApplianceType, string> = {
  [ApplianceType.AIRE]: "¿Tienes aire acondicionado? ¿Cuántas veces por semana y cuántas horas lo usas?",
  [ApplianceType.PLANCHA]: "¿Tienes plancha? ¿Cuántas veces por semana la usas?",
  [ApplianceType.HORNO_AIRFRYER]:
    "¿Tienes horno eléctrico o freidora de aire (air fryer)? ¿Cuántas veces por semana lo usas?",
};

function buildApplianceQaText(appliances: Appliance[]): string {
  if (appliances.length === 0) {
    return "El usuario no reportó tener ninguno de los electrodomésticos preguntados.";
  }

  return appliances
    .map((appliance) => {
      const question = APPLIANCE_QUESTIONS[appliance.type];
      const frequency =
        appliance.frequencyPerWeek !== null && appliance.frequencyPerWeek !== undefined
          ? `${appliance.frequencyPerWeek} veces/semana`
          : "frecuencia no especificada";
      return `Pregunta: ${question}\nRespuesta: ${appliance.usageNote ?? "sin detalle"} (${frequency})`;
    })
    .join("\n\n");
}

function buildReceiptText(receipt: Receipt | null): string {
  if (!receipt?.extractedData) {
    return "No hay datos de consumo del recibo disponibles.";
  }
  return `Datos extraídos del recibo: ${JSON.stringify(receipt.extractedData)}`;
}

/**
 * Arma el cuerpo que se le va a mandar al modelo: las preguntas y
 * respuestas sobre electrodomésticos, los datos ya extraídos del recibo, y
 * la imagen original del recibo (si todavía existe en disco) para que el
 * modelo pueda volver a mirarla si lo necesita.
 */
async function buildPlanGenerationRequest(
  receipt: Receipt | null,
  appliances: Appliance[]
): Promise<PlanGenerationRequest> {
  let image: PlanGenerationRequest["image"];

  if (receipt?.imagePath) {
    try {
      const imageBase64 = await readImageAsBase64(receipt.imagePath);
      image = { mediaType: guessImageMediaType(receipt.imagePath), base64: imageBase64 };
    } catch {
      // La imagen pudo haberse borrado/movido desde que se procesó el
      // recibo; seguimos solo con el texto extraído.
    }
  }

  const context = `${buildReceiptText(receipt)}\n\nHábitos de electrodomésticos:\n${buildApplianceQaText(appliances)}`;
  const instructions =
    "Con esta información, genera un plan de ahorro energético del 15% en JSON con esta forma: " +
    '{ "targetReductionPercent": number, "summary": string, "recommendations": string[] }. ' +
    'En "summary" resume en una o dos frases de qué se trata el plan y de dónde sale el ahorro.';

  return { image, context, instructions };
}

/**
 * Si el modelo no está disponible devolvemos un plan genérico en vez de
 * romper la conversación: el usuario ya invirtió en contestar todas las
 * preguntas y el plan queda guardado como PENDIENTE para regenerarlo.
 */
const FALLBACK_PLAN: SavingsPlanContent = {
  targetReductionPercent: 15,
  summary:
    "No pude armar tu plan personalizado en este momento, así que te dejo las recomendaciones generales que más ahorro suelen dar.",
  recommendations: [
    "Usa el aire acondicionado en 24 °C y apágalo media hora antes de salir.",
    "Plancha toda la ropa junta en una sola tanda, en vez de prender la plancha varias veces.",
    "Aprovecha el calor residual del horno: apágalo unos minutos antes de terminar la cocción.",
  ],
};

async function generatePlanContent(
  request: PlanGenerationRequest
): Promise<SavingsPlanContent | null> {
  try {
    return await requestJson<SavingsPlanContent>({
      system: PLAN_SYSTEM,
      prompt: `${request.context}\n\n${request.instructions}`,
      image: request.image,
      maxTokens: 4096,
    });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[plan] falló la generación del plan:", error.message);
      return null;
    }
    throw error;
  }
}

export interface GeneratedPlan {
  plan: SavingsPlan;
  // El mismo contenido que se guardó, ya tipado, para que el flow lo pueda
  // mandar por WhatsApp sin castear el Json de Prisma.
  content: SavingsPlanContent;
  /** false cuando la IA no respondió y se guardó el plan genérico. */
  personalized: boolean;
}

export interface MonthlyPlanStatus {
  /** true si este usuario ya tiene su plan personalizado del mes en curso. */
  alreadyDoneThisMonth: boolean;
  /** Cuándo se generó ese plan. */
  generatedAt?: Date;
}

/**
 * El plan se arma una vez al mes, que es el ritmo al que llega la factura:
 * rehacerlo a los dos días no aporta nada y gasta llamadas al modelo.
 *
 * Se mide por mes calendario sobre `updatedAt` (no `createdAt`): el plan se
 * guarda con upsert, así que el registro es siempre el mismo y lo que se
 * mueve al regenerarlo es la fecha de actualización.
 *
 * Un plan PENDIENTE no cuenta: ése es el genérico que se guarda cuando la IA
 * no estaba disponible, y el usuario tiene derecho a volver a intentarlo.
 */
export async function getMonthlyPlanStatus(
  userId: string
): Promise<MonthlyPlanStatus> {
  const plan = await planRepository.findLatestByUserId(userId);

  if (!plan || plan.status !== PlanStatus.GENERADO) {
    return { alreadyDoneThisMonth: false };
  }

  const ahora = new Date();
  const mismoMes =
    plan.updatedAt.getFullYear() === ahora.getFullYear() &&
    plan.updatedAt.getMonth() === ahora.getMonth();

  return {
    alreadyDoneThisMonth: mismoMes,
    generatedAt: plan.updatedAt,
  };
}

export async function generateSavingsPlan(
  userId: string
): Promise<GeneratedPlan> {
  const receipt = await receiptRepository.findLatestByUserId(userId);
  const appliances = await applianceRepository.findAllByUserId(userId);

  const request = await buildPlanGenerationRequest(receipt, appliances);
  const content = await generatePlanContent(request);

  const finalContent = content ?? FALLBACK_PLAN;

  const plan = await planRepository.upsertForUser({
    userId,
    content: { ...finalContent },
    // PENDIENTE deja marcado que ese plan es el genérico y habría que
    // volver a generarlo cuando la IA esté disponible.
    status: content ? PlanStatus.GENERADO : PlanStatus.PENDIENTE,
  });

  return { plan, content: finalContent, personalized: content !== null };
}
