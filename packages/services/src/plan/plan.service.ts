import {
  receiptRepository,
  applianceRepository,
  planRepository,
  PlanStatus,
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
import { getApplianceQuestionText } from "../appliances/appliance-questions.js";

/**
 * Lo que se le pide a la IA que ataque. El plan se diseña para 15% aunque al
 * usuario se le prometa 10%: la diferencia es el colchón para que la meta se
 * cumpla incluso si sigue el plan a medias.
 */
export const PLAN_REDUCTION_PERCENT = 15;

/** Lo que se le promete al usuario y contra lo que se mide la próxima factura. */
export const PROMISED_REDUCTION_PERCENT = 10;

/**
 * El kWh objetivo sale de una cuenta en el código, no del modelo: es el dato
 * contra el que el usuario va a comparar su próxima factura y no puede
 * depender de que la IA multiplique bien.
 */
export function calculateTargetKwh(averageConsumptionKwh: number): number {
  return Math.round(
    averageConsumptionKwh * (1 - PROMISED_REDUCTION_PERCENT / 100)
  );
}

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
  frecuencia que el usuario declaró, y usa el consumo en kWh del recibo para
  dimensionar el ahorro.
- Prioriza los electrodomésticos de mayor potencia entre los que el usuario declaró
  tener: el aire acondicionado gasta mucho más que el horno o la freidora de aire, y
  esos mucho más que la plancha. Las primeras recomendaciones tienen que atacar los
  de mayor consumo, que es donde está el grueso del 15%.
- Nunca hables de dinero: ni precios, ni pesos, ni tarifas, ni cuánto se ahorra en la
  factura. El ahorro se cuenta en kWh y en acciones concretas.
- No escribas NINGÚN porcentaje ni la meta total de ahorro, ni en "summary" ni en
  "recommendations". La meta se la muestra el bot por su cuenta, con una cifra
  distinta de la tuya: si tú también la escribes, el usuario ve dos números que no
  coinciden. Nada de "reducir 15%", "bajar un 10%" ni "ahorrar 17 kWh en total".
  Diseña el plan para el 15%, pero cuéntalo en acciones y, si ayuda, en los kWh que
  ahorra cada electrodoméstico por separado.
- Si tienes el consumo promedio de los últimos meses (averageConsumptionKwh), úsalo
  como referencia: calcula el 15% sobre ese promedio y comenta si el mes facturado
  estuvo por encima o por debajo de lo habitual. Si no lo tienes, trabaja con el
  consumo del período y no lo menciones.
- Si el usuario dijo que no tiene un electrodoméstico, no lo recomiendes.
- Entre 3 y 5 recomendaciones, cada una accionable y en una o dos frases.
- Escribe en español colombiano neutro, tratando al usuario de "tú", sin tecnicismos
  ni markdown. Nada de insultos ni de modismos de otros países.
- Responde únicamente con el JSON pedido.`;

function buildApplianceQaText(appliances: Appliance[]): string {
  if (appliances.length === 0) {
    return "El usuario no reportó tener ninguno de los electrodomésticos preguntados.";
  }

  return appliances
    .map((appliance) => {
      const question = getApplianceQuestionText(appliance.type);
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

/**
 * Los datos del recibo tal como se guardaron, tipados para poder leerlos: en
 * Prisma `extractedData` es un Json suelto.
 */
function readExtractedData(
  receipt: Receipt | null
): Record<string, unknown> | null {
  const data = receipt?.extractedData;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  return data as Record<string, unknown>;
}

function readAverageConsumptionKwh(receipt: Receipt | null): number | undefined {
  const valor = readExtractedData(receipt)?.averageConsumptionKwh;
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/**
 * El monto dejó de extraerse y de guardarse, y la migración
 * `drop_receipt_amount` lo sacó de las filas viejas. Este filtro queda como
 * red de seguridad para cualquier base que todavía no la haya corrido: si el
 * dato no viaja, no hay forma de que se le escape un precio al modelo.
 */
function buildReceiptText(receipt: Receipt | null): string {
  const data = readExtractedData(receipt);
  if (!data) {
    return "No hay datos de consumo del recibo disponibles.";
  }

  const { amount, currency, ...sinDinero } = data;
  return `Datos extraídos del recibo: ${JSON.stringify(sinDinero)}`;
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
    `Con esta información, genera un plan de ahorro energético del ${PLAN_REDUCTION_PERCENT}% en JSON con esta forma: ` +
    '{ "targetReductionPercent": number, "summary": string, "recommendations": string[] }. ' +
    'En "summary" resume en una o dos frases de qué se trata el plan y de dónde sale el ahorro, ' +
    "sin mencionar dinero y sin escribir ningún porcentaje ni la meta total: de eso se " +
    "encarga el bot. En \"targetReductionPercent\" sí devuelve el número, que es de uso interno.";

  return { image, context, instructions };
}

/**
 * Si el modelo no está disponible devolvemos un plan genérico en vez de
 * romper la conversación: el usuario ya invirtió en contestar todas las
 * preguntas y el plan queda guardado como PENDIENTE para regenerarlo.
 */
const FALLBACK_PLAN: SavingsPlanContent = {
  targetReductionPercent: PLAN_REDUCTION_PERCENT,
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
      mock: () => ({
        targetReductionPercent: PLAN_REDUCTION_PERCENT,
        summary:
          "Plan simulado (AI_MOCK=true, no se llamó a la IA real) a partir de tus datos.",
        recommendations: [
          "Usa el aire acondicionado en 24 °C y apágalo media hora antes de salir.",
          "Plancha toda la ropa junta en una sola tanda, en vez de prender la plancha varias veces.",
          "Aprovecha el calor residual del horno: apágalo unos minutos antes de terminar la cocción.",
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
  /**
   * Consumo al que hay que llegar en la próxima factura, calculado acá sobre
   * el promedio del recibo. undefined si nunca se pudo saber el promedio.
   */
  targetKwh?: number;
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

  const averageConsumptionKwh = readAverageConsumptionKwh(receipt);

  return {
    plan,
    content: finalContent,
    personalized: content !== null,
    targetKwh:
      averageConsumptionKwh !== undefined
        ? calculateTargetKwh(averageConsumptionKwh)
        : undefined,
  };
}
