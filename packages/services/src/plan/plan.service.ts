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
import { guessImageMediaType, readImageAsBase64 } from "../shared/image.js";

export interface SavingsPlanContent {
  targetReductionPercent: number;
  summary: string;
  recommendations: string[];
}

// Mismo criterio que receipt.service.ts: ver AI_INTEGRATION.md para el
// detalle de qué falta implementar y qué no tocar. El proveedor/modelo
// todavía no está definido a propósito.
export interface PlanGenerationRequest {
  image?: { mediaType: string; base64: string };
  context: string;
  instructions: string;
}

const APPLIANCE_QUESTIONS: Record<ApplianceType, string> = {
  [ApplianceType.AIRE]: "¿Tenés aire acondicionado? ¿Cuántas veces por semana y cuántas horas lo usás?",
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
    "Con esta información, generá un plan de ahorro energético del 15% en JSON con esta forma: " +
    '{ "targetReductionPercent": number, "summary": string, "recommendations": string[] }.';

  return { image, context, instructions };
}

// MOCK - ver AI_INTEGRATION.md. Por ahora devuelve un plan placeholder para
// poder completar el flujo de punta a punta.
async function generatePlanContent(_request: PlanGenerationRequest): Promise<SavingsPlanContent> {
  return {
    targetReductionPercent: 15,
    summary: "Plan de ahorro energético placeholder (pendiente de generar con IA).",
    recommendations: [
      "Reducir el uso del aire acondicionado en horas pico.",
      "Planchar la ropa en tandas para evitar encendidos repetidos.",
      "Usar el horno/air fryer en horarios de menor tarifa.",
    ],
  };
}

export async function generateSavingsPlan(
  userId: string
): Promise<SavingsPlan> {
  const receipt = await receiptRepository.findLatestByUserId(userId);
  const appliances = await applianceRepository.findAllByUserId(userId);

  const request = await buildPlanGenerationRequest(receipt, appliances);
  const content = await generatePlanContent(request);

  return planRepository.upsertForUser({
    userId,
    content: { ...content },
    status: PlanStatus.GENERADO,
  });
}
