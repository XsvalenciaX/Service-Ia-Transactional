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
  amount?: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface ProcessReceiptResult {
  analysis: ReceiptAnalysisResult;
  // Solo se guarda en la base y se devuelve si analysis.valid es true.
  receipt?: Receipt;
}

const ANALYSIS_SYSTEM = `Sos un lector de recibos de energía eléctrica de Colombia.
Extraés datos de la foto que manda el usuario por WhatsApp y respondés únicamente
con el JSON pedido, sin texto alrededor.

Reglas:
- Si la imagen no es un recibo de luz, está borrosa, recortada o no se leen los
  datos, respondé valid=false y explicá en "recommendation" qué hacer, en una
  frase corta, en español rioplatense y tuteando al usuario.
- No inventes valores: si un dato no se ve en la imagen, omitilo en vez de estimarlo.
- Los montos van como número, sin separadores de miles ni símbolo de moneda.`;

const ANALYSIS_PROMPT = `Analizá esta imagen de un recibo de energía eléctrica.

Respondé en JSON con esta forma exacta:
{
  "valid": boolean,          // true si es un recibo de luz legible
  "recommendation": string,  // solo si valid=false: por qué no se pudo leer y qué debería hacer el usuario (ej. foto borrosa, mala luz, no es un recibo)
  "consumptionKwh": number,  // solo si valid=true: consumo en kWh del período
  "amount": number,          // solo si valid=true: monto total facturado
  "currency": string,        // solo si valid=true: moneda del monto (ej. "COP")
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
    });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[receipt] falló la lectura del recibo:", error.message);
      return {
        valid: false,
        recommendation:
          "Tuve un problema para procesar la imagen. Probá mandándola de nuevo en un momento.",
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
export async function processReceipt(
  userId: string,
  imagePath: string
): Promise<ProcessReceiptResult> {
  const imageBase64 = await readImageAsBase64(imagePath);
  const mediaType = guessImageMediaType(imagePath);

  const request = buildReceiptAnalysisRequest(imageBase64, mediaType);
  const analysis = await analyzeReceiptWithModel(request);

  if (!analysis.valid) {
    return { analysis };
  }

  const receipt = await receiptRepository.create({
    userId,
    imagePath,
    extractedData: {
      consumptionKwh: analysis.consumptionKwh,
      amount: analysis.amount,
      currency: analysis.currency,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
    },
  });

  return { analysis, receipt };
}

/**
 * Se usa cuando se agotaron los intentos de leer la foto: el usuario mismo
 * escribe su consumo promedio. Sin `imagePath` ni el resto de los datos del
 * recibo (monto, período), sólo el kWh que dio.
 */
export async function saveManualConsumption(
  userId: string,
  consumptionKwh: number
): Promise<Receipt> {
  return receiptRepository.create({
    userId,
    extractedData: { consumptionKwh, source: "manual" },
  });
}
