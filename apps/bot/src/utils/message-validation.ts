import type { FlowContext } from "../types/flow.js";

// BaileysProvider reescribe `ctx.body` con una referencia "_event_<tipo>_<uuid>"
// cuando el mensaje entrante no es texto plano (imagen, audio, video,
// documento, sticker, ubicación) — ver @builderbot/provider-baileys,
// generateRefProvider(). Lo usamos para exigir texto en preguntas abiertas.
const NON_TEXT_BODY_PREFIX = "_event_";

export function isTextMessage(ctx: FlowContext): boolean {
  return typeof ctx.body === "string" && !ctx.body.startsWith(NON_TEXT_BODY_PREFIX);
}

/**
 * Saca el número de kWh de un mensaje escrito a mano: "265", "265 kwh",
 * "es 1.250 kWh", "promedio 265,5". Devuelve undefined si el mensaje no trae
 * ningún número (ahí es una consulta, no el dato que pedimos).
 */
export function extractKwh(text: string): number | undefined {
  const match = /(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d+))?/.exec(text.trim());
  if (!match) {
    return undefined;
  }

  // "1.250" y "1,250" son miles; "265,5" es decimal. Se distinguen por el
  // largo del grupo que viene después del separador.
  const entero = match[1].replace(/[.,]/g, "");
  const decimales = match[2] ?? "";
  const valor = Number(decimales ? `${entero}.${decimales}` : entero);

  return Number.isFinite(valor) ? valor : undefined;
}

// Palabras que sí pueden acompañar al número sin que deje de ser el dato que
// pedimos: "son 265 kwh", "mi consumo promedio es 300".
const KWH_FILLER =
  /\b(kwh|kw|kilovatios?|kilowatts?|promedio|consumo|mensual|mes|aprox|aproximadamente|es|son|de|del|el|la|mi|unos|como|mas|más|menos|o|y)\b/g;

/**
 * ¿El mensaje es *sólo* el número que pedimos, o una frase que casualmente
 * trae uno? extractKwh() se queda con el primer número que encuentre, así que
 * sin este filtro "quién ganó el mundial 2022" se guardaba como 2022 kWh de
 * consumo promedio y el plan salía armado sobre un año.
 */
export function isStandaloneKwh(text: string): boolean {
  const resto = text
    .trim()
    .toLowerCase()
    .replace(/[\d.,]+/g, " ")
    .replace(KWH_FILLER, " ")
    .replace(/[^a-záéíóúñ]/g, "");

  return resto.length === 0;
}

const QUESTION_STARTERS =
  /^(qué|que|cuál|cual|cuánt|cuant|cómo|por qué|por que|para qué|para que|cuándo|dónde|donde|quién|quien|explicame|explícame|no entiendo|me explicás|me explicas)/;

/**
 * Heurística para decidir si, en medio de una pregunta del bot, el usuario
 * contestó o preguntó otra cosa. Es a propósito local y barata: mandar cada
 * respuesta al modelo sólo para clasificarla duplicaría el costo de una
 * conversación, y la enorme mayoría son respuestas normales.
 */
export function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("?") || normalized.includes("¿")) {
    return true;
  }

  // "como 4 noches", "3 veces por semana": si hay un número es una respuesta,
  // aunque arranque con una palabra que también sirve para preguntar.
  if (/\d/.test(normalized)) {
    return false;
  }

  return QUESTION_STARTERS.test(normalized);
}
