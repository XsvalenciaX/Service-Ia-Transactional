import Anthropic from "@anthropic-ai/sdk";
import type { ImageMediaType } from "./image.js";

/**
 * Modelo por defecto: el más barato del catálogo que entiende imágenes
 * ($1 por millón de tokens de entrada, $5 de salida), que es lo que se
 * necesita para leer la foto de un recibo. Si en algún momento la extracción
 * se queda corta, `AI_MODEL` en el .env permite probar uno más capaz
 * (`claude-sonnet-5`, `claude-opus-5`) sin tocar código.
 */
export const AI_MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";

// Las imágenes viajan en base64 dentro del request, así que una foto muy
// pesada es un request muy pesado (y un error del lado de la API). Las fotos
// que manda WhatsApp vienen comprimidas y quedan bien por debajo de esto.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// USD por millón de tokens [entrada, salida], para estimar en la consola lo
// que va costando cada llamada. Si se usa un modelo que no está acá, se
// loguean los tokens sin el precio.
const PRICES_PER_MTOK: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
};

let spentUsd = 0;

function logUsage(usage: Anthropic.Usage): void {
  const price = PRICES_PER_MTOK[AI_MODEL];
  const parts = [
    `[ai] ${AI_MODEL}`,
    `${usage.input_tokens} tokens in / ${usage.output_tokens} out`,
  ];

  if (price) {
    const cost =
      (usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1_000_000;
    spentUsd += cost;
    parts.push(`~USD ${cost.toFixed(5)}`, `acumulado USD ${spentUsd.toFixed(5)}`);
  }

  console.log(parts.join(" · "));
}

/**
 * Todo lo que puede salir mal al hablar con el modelo (falta de API key,
 * key inválida, rate limit, respuesta no parseable) sale como AiError, para
 * que los servicios lo puedan distinguir de un bug y degradar en vez de
 * cortarle la conversación al usuario.
 */
export class AiError extends Error {}

let client: Anthropic | null = null;

/**
 * El cliente se crea la primera vez que se lo usa, no al importar el módulo:
 * el bot importa estos servicios al arrancar, y sin esto no podría levantar
 * (ni mostrar el QR) hasta tener la API key configurada.
 */
function getClient(): Anthropic {
  if (client) {
    return client;
  }

  const apiKey =
    process.env.AI_PROVIDER_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new AiError(
      "Falta la API key de IA: definí AI_PROVIDER_API_KEY en el .env de la raíz."
    );
  }

  client = new Anthropic({ apiKey });
  return client;
}

export interface AiImage {
  mediaType: ImageMediaType;
  base64: string;
}

export interface AiJsonRequest {
  /** Rol y reglas fijas del pedido. */
  system: string;
  /** El pedido concreto, incluida la forma del JSON esperado. */
  prompt: string;
  image?: AiImage;
  maxTokens?: number;
}

/**
 * El modelo tiende a envolver el JSON en un texto ("Acá va el análisis:",
 * bloques ```json), así que nos quedamos con lo que hay entre la primera
 * llave y la última en vez de exigir una respuesta perfecta.
 */
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new AiError(`La respuesta del modelo no traía JSON: ${text.slice(0, 200)}`);
  }

  return text.slice(start, end + 1);
}

export function assertImageSize(base64: string): void {
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new AiError(
      `La imagen pesa ${Math.round(bytes / 1024 / 1024)} MB y el máximo son ${
        MAX_IMAGE_BYTES / 1024 / 1024
      } MB.`
    );
  }
}

/**
 * Una sola llamada al modelo que devuelve JSON. No usamos thinking ni tool
 * use: las dos tareas (extraer datos de un recibo, redactar un plan) son de
 * un solo paso y así la prueba sale lo más barata posible.
 */
export async function requestJson<T>(request: AiJsonRequest): Promise<T> {
  const content: Anthropic.ContentBlockParam[] = [];

  if (request.image) {
    assertImageSize(request.image.base64);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: request.image.mediaType,
        data: request.image.base64,
      },
    });
  }

  content.push({ type: "text", text: request.prompt });

  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create({
      model: AI_MODEL,
      max_tokens: request.maxTokens ?? 2048,
      system: request.system,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiError("La API key de IA es inválida o está vencida.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError("La API de IA está rate limited, hay que reintentar en un rato.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiError(`Error ${error.status} de la API de IA: ${error.message}`);
    }
    throw error;
  }

  logUsage(response.usage);

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  try {
    return JSON.parse(extractJson(text)) as T;
  } catch (error) {
    if (error instanceof AiError) {
      throw error;
    }
    throw new AiError(`No pude parsear el JSON del modelo: ${text.slice(0, 200)}`);
  }
}
