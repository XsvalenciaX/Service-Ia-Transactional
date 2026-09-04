import type { FlowContext } from "../types/flow.js";

// BaileysProvider reescribe `ctx.body` con una referencia "_event_<tipo>_<uuid>"
// cuando el mensaje entrante no es texto plano (imagen, audio, video,
// documento, sticker, ubicación) — ver @builderbot/provider-baileys,
// generateRefProvider(). Lo usamos para exigir texto en preguntas abiertas.
const NON_TEXT_BODY_PREFIX = "_event_";

export function isTextMessage(ctx: FlowContext): boolean {
  return typeof ctx.body === "string" && !ctx.body.startsWith(NON_TEXT_BODY_PREFIX);
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
