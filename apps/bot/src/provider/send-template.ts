import type { TemplatePrompt } from "@energy-bot/services";
import type { FlowMethods } from "../types/flow.js";
import { toWhatsappAddress } from "./twilio-address.js";

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
      from: toWhatsappAddress(vendorNumber),
      to: toWhatsappAddress(to),
    });
  }

  return provider.sendMessage(to, prompt.fallbackText, {
    options: {
      buttons: (prompt.fallbackOptions ?? []).map((body) => ({ body })),
    },
  });
}
