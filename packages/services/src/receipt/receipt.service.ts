import { receiptRepository, type Receipt } from "@energy-bot/database";
import {
  guessImageMediaType,
  readImageAsBase64,
  type ImageMediaType,
} from "../shared/image.js";
import { AiError, requestJson } from "../shared/ai.js";

export interface ReceiptAnalysisRequest {
  image: { mediaType: ImageMediaType; base64: string };
  instructions: string;
}

export interface ReceiptAnalysisResult {
  valid: boolean;
  // Presente cuando valid=false: por qué no se pudo leer y qué debería
  // hacer el usuario (ej. "sacá la foto con más luz").
  recommendation?: string;
  consumptionKwh?: number;
  // Promedio de los últimos meses que imprime la propia factura. Suele estar
  // en un recuadro aparte o en el gráfico de barras del historial, así que es
  // el primer dato que se pierde cuando la foto no abarca todo el recibo.
  averageConsumptionKwh?: number;
  // El bot no habla de dinero en ningún momento, así que el monto de la
  // factura no se extrae, no se guarda y no se le muestra al usuario.
  periodStart?: string;
  periodEnd?: string;
}

export interface ProcessReceiptResult {
  analysis: ReceiptAnalysisResult;
  // Solo se guarda en la base y se devuelve si analysis.valid es true.
  receipt?: Receipt;
  // Cuántas fotos válidas mandó ya este usuario, contando ésta. Sirve para
  // no pedirle indefinidamente que repita la foto por un dato que su factura
  // quizá ni siquiera trae impreso.
  attempt: number;
}

const ANALYSIS_SYSTEM = `Eres un lector de recibos de energía eléctrica de Colombia.
Extraes datos de la foto que el usuario manda por WhatsApp y respondes únicamente
con el JSON pedido, sin texto alrededor.

Reglas:
- Si la imagen no es un recibo de luz, está borrosa, recortada o no se leen los
  datos, responde valid=false y explica en "recommendation" qué hacer, en una
  frase corta y en español colombiano neutro, tratando al usuario de "tú".
- Esa frase la lee el usuario tal cual. Nunca uses insultos, apodos ni modismos de
  otros países ("boludo", "che", "güey"): pudo haberse equivocado de foto sin
  querer, así que trátalo siempre con respeto.
- No inventes valores: si un dato no se ve en la imagen, omítelo en vez de estimarlo.
- Los consumos van como número, sin separadores de miles ni unidades.
- No extraigas montos, precios ni tarifas: no los pedimos y no se usan para nada.
- "averageConsumptionKwh" es el promedio que la factura ya trae impreso. Casi
  siempre está en el gráfico de barras del historial: el recuadro se titula algo
  como "Histórico de consumos (kWh) y promedio", y la ÚLTIMA barra —separada de
  las demás y rotulada "PROM"— es ese promedio. Al pie del gráfico suele estar la
  aclaración "PROMEDIO DE LOS ÚLTIMOS 6 MESES = PROM". Mira ese número sobre la
  barra PROM, no el de la barra "Actual", que es el consumo del período.
- Ojo con las facturas agrupadas: la misma hoja puede traer un gráfico de historial
  por cada servicio (acueducto, alcantarillado, gas), medidos en m³. Usa SIEMPRE el
  gráfico cuyo título dice kWh, que es el de energía; nunca uno en m³.
- También puede venir como texto suelto ("consumo promedio", "promedio últimos 6
  meses"). Nunca lo calcules tú ni lo deduzcas del consumo del período: si ese
  número no está impreso en la imagen, omite el campo.`;

const ANALYSIS_PROMPT = `Analiza esta imagen de un recibo de energía eléctrica.

Responde en JSON con esta forma exacta:
{
  "valid": boolean,          // true si es un recibo de luz legible
  "recommendation": string,  // solo si valid=false: por qué no se pudo leer y qué debería hacer el usuario (ej. foto borrosa, mala luz, no es un recibo)
  "consumptionKwh": number,  // solo si valid=true: consumo en kWh del período
  "averageConsumptionKwh": number, // solo si está impreso en el recibo: consumo promedio de los últimos meses. Omitir el campo si no aparece
  "periodStart": string,     // solo si valid=true: inicio del período facturado, formato YYYY-MM-DD
  "periodEnd": string        // solo si valid=true: fin del período facturado, formato YYYY-MM-DD
}`;

function buildReceiptAnalysisRequest(
  imageBase64: string,
  mediaType: ImageMediaType
): ReceiptAnalysisRequest {
  return {
    image: { mediaType, base64: imageBase64 },
    instructions: ANALYSIS_PROMPT,
  };
}

/**
 * Si la llamada al modelo falla (sin API key, rate limit, imagen demasiado
 * pesada) devolvemos valid=false con una explicación: el flow ya sabe pedir
 * la foto de nuevo, y es mejor que cortar la conversación con un error.
 */
async function analyzeReceiptWithModel(
  request: ReceiptAnalysisRequest
): Promise<ReceiptAnalysisResult> {
  try {
    return await requestJson<ReceiptAnalysisResult>({
      system: ANALYSIS_SYSTEM,
      prompt: request.instructions,
      image: request.image,
      // Sin monto: el bot no habla de dinero, así que el mock devuelve
      // exactamente los campos que devuelve la IA de verdad.
      mock: () => ({
        valid: true,
        consumptionKwh: 350,
        averageConsumptionKwh: 320,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
      }),
    });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[receipt] falló la lectura del recibo:", error.message);
      return {
        valid: false,
        recommendation:
          "Tuve un problema para procesar la imagen. Intenta enviándola de nuevo en un momento.",
      };
    }
    throw error;
  }
}

/**
 * Recibe la ruta de la imagen del recibo ya guardada en disco por la capa
 * del bot, la manda a analizar y, si es válida, guarda el recibo con los
 * datos extraídos. Si no es válida, no se guarda nada y se devuelve la
 * recomendación para que el flow se la muestre al usuario.
 */
// Rango defendible para un consumo mensual de hogar chico. Sirve
// para no guardar como kWh un número que en realidad era otra cosa (el total
// a pagar, un año, un número de cuenta).
export const MIN_CONSUMPTION_KWH = 10;
export const MAX_CONSUMPTION_KWH = 20000;

export function isPlausibleConsumption(kwh: number): boolean {
  return (
    Number.isFinite(kwh) &&
    kwh >= MIN_CONSUMPTION_KWH &&
    kwh <= MAX_CONSUMPTION_KWH
  );
}

export async function processReceipt(
  userId: string,
  imagePath: string
): Promise<ProcessReceiptResult> {
  const imageBase64 = await readImageAsBase64(imagePath);
  const mediaType = guessImageMediaType(imagePath);

  const request = buildReceiptAnalysisRequest(imageBase64, mediaType);
  const analysis = await analyzeReceiptWithModel(request);

  if (!analysis.valid) {
    return { analysis, attempt: await receiptRepository.countByUserId(userId) };
  }

  const receipt = await receiptRepository.create({
    userId,
    imagePath,
    extractedData: {
      consumptionKwh: analysis.consumptionKwh,
      averageConsumptionKwh: analysis.averageConsumptionKwh,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
    },
  });

  return {
    analysis,
    receipt,
    attempt: await receiptRepository.countByUserId(userId),
  };
}

/**
 * Se usa cuando se agotaron los intentos de leer la foto: el usuario mismo
 * escribe su consumo. Sin `imagePath` ni el resto de los datos del recibo
 * (período), sólo el kWh que dio.
 *
 * Se guarda como `averageConsumptionKwh` porque es lo que el bot le pidió
 * ("escribime el consumo promedio en kWh"): es el dato con el que
 * `calculateTargetKwh()` arma la meta y el que PLAN_SYSTEM usa de referencia.
 * Guardarlo como consumo del período dejaba a estos usuarios sin objetivo.
 */
export async function saveManualConsumption(
  userId: string,
  averageConsumptionKwh: number
): Promise<Receipt> {
  return receiptRepository.create({
    userId,
    extractedData: { averageConsumptionKwh, source: "manual" },
  });
}
