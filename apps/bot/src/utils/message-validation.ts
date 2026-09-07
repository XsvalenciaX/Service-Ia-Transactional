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
 * `InteractiveData` es lo que Twilio agrega al webhook cuando el mensaje es
 * la respuesta a un `twilio/flows` (ver appliances.flow.ts) -- viene como
 * JSON en texto, no como campo estándar de BuilderBot, así que no está en
 * el tipo `FlowContext`. El proveedor de Twilio hace `{...req.body, ...}`
 * (ver @builderbot/provider-twilio), así que llega tal cual a `ctx`.
 *
 * Body vacío: BuilderBot descarta en silencio cualquier mensaje con `body`
 * falsy (@builderbot/bot, handleMsg), y una respuesta de flow nunca trae
 * Body -- por eso index.ts le rellena un `body` sintético antes de que
 * BuilderBot la vea, para que esta función igual pueda leer InteractiveData.
 */
export function readInteractiveData(ctx: FlowContext): Record<string, unknown> | null {
  const raw = (ctx as unknown as { InteractiveData?: string }).InteractiveData;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
