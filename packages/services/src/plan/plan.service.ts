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
import { isPlausibleConsumption } from "../receipt/receipt.service.js";

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
- El usuario puede haber declarado muchos electrodomésticos. NO hagas una
  recomendación por cada uno: elige los pocos que más kWh pueden ahorrar y concentra
  el plan ahí. Lo que decide no es la potencia sola, sino POTENCIA × TIEMPO DE USO
  declarado: un secador de pelo consume mucho pero se usa minutos, y un ventilador
  consume poco pero puede quedar prendido toda la noche.
- Potencia típica en un hogar colombiano, para que estimes ese peso:
  · Muy alta (2.000-5.500 W): calentador de agua eléctrico (ducha), estufa eléctrica.
  · Alta (1.000-2.500 W): aire acondicionado, calefactor, horno eléctrico o freidora
    de aire, máquina lavaplatos, plancha de ropa, microondas, secador de pelo,
    aspiradora.
  · Media (300-800 W): arrocera, lavadora, licuadora, secadora de ropa a gas (de
    electricidad sólo gasta el motor del tambor).
  · Baja (40-200 W): televisor, consola de videojuegos, equipo de sonido, ventilador,
    plancha de pelo.
- Cruza esa potencia con la frecuencia o las horas que el usuario declaró y ordena
  las recomendaciones por el ahorro en kWh que consigue cada una, de mayor a menor.
  Ahí está el grueso del 15%: dos o tres cambios en lo que más pesa rinden más que
  muchos consejos repartidos.
- Nunca hables de dinero: ni precios, ni pesos, ni tarifas, ni cuánto se ahorra en la
  factura. El ahorro se cuenta en kWh y en acciones concretas.
- No escribas NINGÚN porcentaje ni la meta total de ahorro, ni en "summary" ni en
  "recommendations". La meta se la muestra el bot por su cuenta, con una cifra
  distinta de la tuya: si tú también la escribes, el usuario ve dos números que no
  coinciden. Nada de "reducir 15%", "bajar un 10%" ni "ahorrar 17 kWh en total".
  Diseña el plan para el 15%, pero cuéntalo en acciones y, si ayuda, en los kWh que
  ahorra cada electrodoméstico por separado.
- Si tienes el consumo promedio de los últimos meses (averageConsumptionKwh), úsalo
  como referencia interna para dimensionar cuántos kWh hay que recortar en total, y
  comenta si el mes facturado estuvo por encima o por debajo de lo habitual. Esa
  cuenta la haces para elegir las recomendaciones, no para escribirla. Si no tienes
  el promedio, trabaja con el consumo del período y no lo menciones.
- Si el usuario dijo que no tiene un electrodoméstico, no lo recomiendes.
- UNA recomendación por electrodoméstico, y MÁXIMO 4 en total: las de los 4 de mayor
  impacto, ordenadas de mayor a menor ahorro. Si el usuario declaró menos de 4,
  entrega sólo esa cantidad — con un electrodoméstico, una o dos recomendaciones
  están bien. Nunca rellenes para llegar a 4 ni repitas el mismo consejo partido en
  dos: una lista corta y contundente sirve más que una larga y diluida, y en WhatsApp
  no se lee.
- CADA recomendación se escribe con esta forma exacta, que es la que mejor funciona:
  "<Electrodoméstico>: <cómo lo usa hoy, con el dato que declaró>. <Acción concreta>;
  <el cambio puntual> puede ahorrar aproximadamente <N> kWh al mes."
  Ejemplos:
  "Ventilador: actualmente permanece encendido 24 horas al día. Apágalo cuando no
  estés en el espacio y usa temporizador para evitar que funcione toda la noche;
  reducir 8 horas diarias puede ahorrar aproximadamente 11 kWh al mes."
  "Lavadora: la usas una vez por semana. Mantén las cargas completas y evita ciclos
  adicionales o de agua caliente; esta medida puede ahorrar aproximadamente 0,5 kWh
  al mes."
  Es decir: empieza con el nombre del electrodoméstico y dos puntos; recuérdale el uso
  que él mismo declaró; dile qué hacer; y cierra con el ahorro de ESA recomendación en
  kWh al mes, siempre con "aproximadamente" porque es una estimación tuya a partir de
  la potencia típica y del uso declarado.
- Ese ahorro por recomendación sí va escrito. Lo que nunca va es la suma de todos ni
  la meta del plan: cada línea habla sólo de su propio electrodoméstico.
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

/**
 * Se valida el rango, no sólo el tipo: hay recibos guardados con
 * `averageConsumptionKwh: 0` de cuando el modelo rellenaba con cero en vez de
 * omitir el campo. Sin este filtro, la meta salía como "0 kWh o menos".
 */
function readAverageConsumptionKwh(receipt: Receipt | null): number | undefined {
  const valor = readExtractedData(receipt)?.averageConsumptionKwh;
  return typeof valor === "number" && isPlausibleConsumption(valor)
    ? valor
    : undefined;
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
    `"recommendations" lleva ${MAX_RECOMMENDATIONS} elementos como máximo, ordenados de mayor a menor ahorro en kWh. ` +
    'En "summary" resume en una o dos frases de qué se trata el plan y de dónde sale el ahorro, ' +
    "sin mencionar dinero y sin escribir ningún porcentaje ni la meta total: de eso se " +
    "encarga el bot. En \"targetReductionPercent\" sí devuelve el número, que es de uso interno.";

  return { image, context, instructions };
}

/**
 * Cuántas recomendaciones ve el usuario como mucho. Con 19 electrodomésticos
 * posibles, sin tope el plan se vuelve un listado: es mejor que ataque los
 * pocos que de verdad mueven el consumo.
 */
export const MAX_RECOMMENDATIONS = 4;

function capRecommendations(content: SavingsPlanContent): SavingsPlanContent {
  if (content.recommendations.length <= MAX_RECOMMENDATIONS) {
    return content;
  }

  return {
    ...content,
    recommendations: content.recommendations.slice(0, MAX_RECOMMENDATIONS),
  };
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

  // El tope lo pide el prompt, pero se aplica igual acá: si el modelo se
  // entusiasma y manda seis, el usuario recibiría una lista que no se lee.
  // Vienen ordenadas de mayor a menor ahorro, así que cortar por el final
  // deja las que más pesan.
  const finalContent = capRecommendations(content ?? FALLBACK_PLAN);

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
