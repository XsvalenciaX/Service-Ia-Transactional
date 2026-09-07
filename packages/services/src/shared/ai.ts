import OpenAI from "openai";
import type { ImageMediaType } from "./image.js";

/**
 * Modelo por defecto: el más barato del catálogo que entiende imágenes
 * ($0,20 por millón de tokens de entrada, $1,20 de salida), que es lo que se
 * necesita para leer la foto de un recibo. Si en algún momento la extracción
 * se queda corta, `AI_MODEL` en el .env permite probar uno más capaz
 * (`gpt-5.6-luna-pro`, `gpt-5.4`) sin tocar código.
 */
export const AI_MODEL =
  process.env.AI_MODEL?.trim() ||
  process.env.AI_MODEL_OPENAI?.trim() ||
  "gpt-5.6-luna";

/**
 * Luna es un modelo de razonamiento y los tokens de pensamiento se facturan
 * como salida, que es la parte cara. Las dos tareas (leer un recibo, redactar
 * un plan) son de un solo paso y salen bien sin pensar, así que por defecto va
 * apagado. `AI_REASONING_EFFORT` (none | low | medium | high) permite subirlo
 * si la extracción falla, sabiendo que multiplica el costo.
 */
const REASONING_EFFORT = process.env.AI_REASONING_EFFORT ?? "none";

// Las imágenes viajan en base64 dentro del request, así que una foto muy
// pesada es un request muy pesado (y un error del lado de la API). Las fotos
// que manda WhatsApp vienen comprimidas y quedan bien por debajo de esto.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// USD por millón de tokens [entrada, salida, entrada cacheada], para estimar
// en la consola lo que va costando cada llamada. Si se usa un modelo que no
// está acá, se loguean los tokens sin el precio.
const PRICES_PER_MTOK: Record<string, [number, number, number]> = {
  "gpt-5.6-luna": [0.2, 1.2, 0.02],
  "gpt-5.6-luna-pro": [1.25, 10, 0.125],
  "gpt-5-nano": [0.05, 0.4, 0.005],
  "gpt-4o-mini": [0.15, 0.6, 0.075],
};

let spentUsd = 0;

function logUsage(usage: OpenAI.CompletionUsage | undefined): void {
  if (!usage) {
    return;
  }

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const price = PRICES_PER_MTOK[AI_MODEL];

  const parts = [
    `[ai] ${AI_MODEL}`,
    `${usage.prompt_tokens} tokens in / ${usage.completion_tokens} out`,
  ];

  // Sólo ensucian el log cuando valen algo: el cacheado abarata la entrada y
  // los de razonamiento explican una salida más cara de lo que se ve escrito.
  if (cached) {
    parts.push(`${cached} cacheados`);
  }
  if (reasoning) {
    parts.push(`${reasoning} de razonamiento`);
  }

  if (price) {
    const cost =
      ((usage.prompt_tokens - cached) * price[0] +
        usage.completion_tokens * price[1] +
        cached * price[2]) /
      1_000_000;
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

let client: OpenAI | null = null;

/**
 * El cliente se crea la primera vez que se lo usa, no al importar el módulo:
 * el bot importa estos servicios al arrancar, y sin esto no podría levantar
 * (ni mostrar el QR) hasta tener la API key configurada.
 */
function getClient(): OpenAI {
  if (client) {
    return client;
  }

  // Se aceptan varios nombres a propósito: el .env de este proyecto guarda las
  // keys con sufijo por proveedor (AI_PROVIDER_API_KEY_OPENAI, _Claude) para
  // tenerlas conviviendo, y OPENAI_API_KEY es el nombre que usa el SDK oficial.
  const apiKey =
    process.env.AI_PROVIDER_API_KEY_OPENAI?.trim() ||
    process.env.AI_PROVIDER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new AiError(
      "Falta la API key de IA: definí AI_PROVIDER_API_KEY_OPENAI en el .env de la raíz."
    );
  }

  client = new OpenAI({ apiKey });
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
 * Una sola llamada al modelo que devuelve JSON. No usamos tool use ni
 * razonamiento: las dos tareas (extraer datos de un recibo, redactar un plan)
 * son de un solo paso y así la prueba sale lo más barata posible.
 */
export async function requestJson<T>(request: AiJsonRequest): Promise<T> {
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

  if (request.image) {
    assertImageSize(request.image.base64);
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${request.image.mediaType};base64,${request.image.base64}`,
      },
    });
  }

  content.push({ type: "text", text: request.prompt });

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await getClient().chat.completions.create({
      model: AI_MODEL,
      // Los modelos de razonamiento cuentan acá también los tokens que piensan,
      // no sólo los que escriben.
      max_completion_tokens: request.maxTokens ?? 2048,
      reasoning_effort: REASONING_EFFORT as "none" | "low" | "medium" | "high",
      // El modelo soporta structured outputs; con esto el JSON viene limpio y
      // extractJson queda sólo como red de seguridad.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content },
      ],
    });
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      throw new AiError("La API key de IA es inválida o está vencida.");
    }
    if (error instanceof OpenAI.RateLimitError) {
      throw new AiError("La API de IA está rate limited, hay que reintentar en un rato.");
    }
    if (error instanceof OpenAI.APIError) {
      throw new AiError(`Error ${error.status} de la API de IA: ${error.message}`);
    }
    throw error;
  }

  logUsage(response.usage);

  const choice = response.choices[0];

  // Con razonamiento prendido el presupuesto de salida se puede ir entero en
  // pensar y volver sin texto: sin esto, el error sería un "no traía JSON"
  // que no dice qué pasó realmente.
  if (choice?.finish_reason === "length") {
    throw new AiError(
      `El modelo se quedó sin tokens de salida (max_completion_tokens=${
        request.maxTokens ?? 2048
      }).`
    );
  }

  const text = choice?.message?.content ?? "";

  try {
    return JSON.parse(extractJson(text)) as T;
  } catch (error) {
    if (error instanceof AiError) {
      throw error;
    }
    throw new AiError(`No pude parsear el JSON del modelo: ${text.slice(0, 200)}`);
  }
}
