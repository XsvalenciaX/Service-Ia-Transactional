import type { FlowContext } from "../types/flow.js";

// BaileysProvider reescribe `ctx.body` con una referencia "_event_<tipo>_<uuid>"
// cuando el mensaje entrante no es texto plano (imagen, audio, video,
// documento, sticker, ubicación) — ver @builderbot/provider-baileys,
// generateRefProvider(). Lo usamos para exigir texto en preguntas abiertas.
const NON_TEXT_BODY_PREFIX = "_event_";

export function isTextMessage(ctx: FlowContext): boolean {
  return typeof ctx.body === "string" && !ctx.body.startsWith(NON_TEXT_BODY_PREFIX);
}
