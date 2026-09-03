import { receiptRepository, type Receipt } from "@energy-bot/database";
import { guessImageMediaType, readImageAsBase64 } from "../shared/image.js";

// Datos ya armados para mandarle al modelo de IA cuando se conecte (ver
// AI_INTEGRATION.md para el detalle de qué falta implementar y qué no
// tocar). El proveedor/modelo todavía no está definido a propósito.
export interface ReceiptAnalysisRequest {
  image: { mediaType: string; base64: string };
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
  mediaType: string
): ReceiptAnalysisRequest {
  return {
    image: { mediaType, base64: imageBase64 },
    instructions: ANALYSIS_PROMPT,
  };
}

// MOCK - ver AI_INTEGRATION.md. Por ahora siempre responde "válido" con
// datos fijos para poder probar el flujo de punta a punta.
async function analyzeReceiptWithModel(
  _request: ReceiptAnalysisRequest
): Promise<ReceiptAnalysisResult> {
  return {
    valid: true,
    consumptionKwh: 350,
    amount: 185000,
    currency: "COP",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
  };
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
