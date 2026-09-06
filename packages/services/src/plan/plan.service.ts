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

const PLAN_SYSTEM = `Sos un asesor de eficiencia energética que le arma a un usuario
de WhatsApp un plan para bajar un 15% su consumo eléctrico.

Trabajás con dos insumos: los datos del recibo de luz del usuario y las respuestas
que dio sobre cómo usa sus electrodomésticos. Reglas:
- Basá cada recomendación en esos datos concretos: mencioná el electrodoméstico y
  la frecuencia que el usuario declaró, y cuando tengas el consumo o el monto del
  recibo, usalos para dimensionar el ahorro.
- Si el usuario dijo que no tiene un electrodoméstico, no lo recomiendes.
- Entre 3 y 5 recomendaciones, cada una accionable y en una o dos frases.
- Escribí en español rioplatense, tuteando, sin tecnicismos ni markdown.
- Respondé únicamente con el JSON pedido.`;

const APPLIANCE_QUESTIONS: Record<ApplianceType, string> = {
  [ApplianceType.AIRE]: "¿Tenés aire acondicionado? ¿Cuántas horas por día lo dejás encendido en promedio?",
  [ApplianceType.PLANCHA]: "¿Tenés plancha? ¿Cuántas veces por semana la usás?",
  [ApplianceType.HORNO_AIRFRYER]:
    "¿Tenés horno eléctrico o freidora de aire (air fryer)? ¿Cuántas veces por semana lo usás?",
};

function buildApplianceQaText(appliances: Appliance[]): string {
  if (appliances.length === 0) {
    return "El usuario no reportó tener ninguno de los electrodomésticos preguntados.";
  }

  return appliances
    .map((appliance) => {
      const question = APPLIANCE_QUESTIONS[appliance.type];
      const detail =
        appliance.hoursPerDay !== null && appliance.hoursPerDay !== undefined
          ? `${appliance.hoursPerDay} horas/día`
          : appliance.frequencyPerWeek !== null && appliance.frequencyPerWeek !== undefined
            ? `${appliance.frequencyPerWeek} veces/semana`
            : "sin detalle";
      return `Pregunta: ${question}\nRespuesta: ${detail}`;
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
    "Con esta información, generá un plan de ahorro energético del 15% en JSON con esta forma: " +
    '{ "targetReductionPercent": number, "summary": string, "recommendations": string[] }. ' +
    'En "summary" resumí en una o dos frases de qué se trata el plan y de dónde sale el ahorro.';

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
    "Usá el aire acondicionado en 24 °C y apagalo media hora antes de salir.",
    "Planchá toda la ropa junta en una sola tanda, en vez de prender la plancha varias veces.",
    "Aprovechá el calor residual del horno: apagalo unos minutos antes de terminar la cocción.",
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
      mock: () => ({
        targetReductionPercent: 15,
        summary:
          "Plan simulado (AI_MOCK=true, no se llamó a la IA real) a partir de tus datos.",
        recommendations: [
          "Usá el aire acondicionado en 24 °C y apagalo media hora antes de salir.",
          "Planchá toda la ropa junta en una sola tanda, en vez de prender la plancha varias veces.",
          "Aprovechá el calor residual del horno: apagalo unos minutos antes de terminar la cocción.",
        ],
      }),
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
