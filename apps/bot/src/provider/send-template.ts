import type { TemplatePrompt } from "../flows/appliance-questions.js";
import type { FlowMethods } from "../types/flow.js";

// Mismo formato que usa @builderbot/provider-twilio internamente
// (parseNumberFrom en su bundle): "whatsapp:+<solo dígitos>".
function toWhatsappNumber(raw: string): string {
  return `whatsapp:+${raw.replace(/whatsapp|:|\+/g, "").replace(/\s/g, "")}`;
}

/**
 * Manda una plantilla de contenido de Twilio (botones o lista) usando el
 * cliente de Twilio directo: `provider.sendMessage` de BuilderBot no soporta
 * `contentSid`/`contentVariables`, así que la opción `buttons` de
 * `addAnswer` no produce nada real contra WhatsApp (ver
 * @builderbot/provider-twilio, `sendButtons()` sólo loguea un aviso).
 *
 * Si no hay un cliente de Twilio real (p.ej. el WebProvider del simulador,
 * ver dev/simulator.ts), cae a `provider.sendMessage` con el texto/botones
 * de fallback para poder seguir probando el flujo sin WhatsApp.
 */
export async function sendTemplate(
  provider: FlowMethods["provider"],
  to: string,
  prompt: TemplatePrompt
): Promise<unknown> {
  const twilioClient = provider?.vendor?.twilio;
  const vendorNumber = provider?.globalVendorArgs?.vendorNumber;

  if (twilioClient && vendorNumber) {
    return twilioClient.messages.create({
      contentSid: prompt.contentSid,
      contentVariables: prompt.variables ? JSON.stringify(prompt.variables) : undefined,
      from: toWhatsappNumber(vendorNumber),
      to: toWhatsappNumber(to),
    });
  }

  return provider.sendMessage(to, prompt.fallbackText, {
    options: {
      buttons: (prompt.fallbackOptions ?? []).map((body) => ({ body })),
    },
  });
}
