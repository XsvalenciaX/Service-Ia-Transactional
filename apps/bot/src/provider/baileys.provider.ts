import { createProvider } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { fetchLatestBaileysVersion } from "baileys";

// @builderbot/provider-baileys@1.4.2 fija una versión vieja del protocolo de
// WhatsApp ([2, 3000, 1025190524]), que WhatsApp ya rechaza con error 405.
// Pedimos la versión vigente y se la pasamos explícita (globalVendorArgs
// pisa el valor hardcodeado del provider).
export const createBaileysProvider = async () => {
  const { version } = await fetchLatestBaileysVersion();

  return createProvider(BaileysProvider, {
    name: process.env.BOT_SESSION_NAME ?? "energy-bot",
    version,
  });
};
