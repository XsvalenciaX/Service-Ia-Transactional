import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// El .env vive en la raíz del monorepo. Esto tiene que correr ANTES de
// importar cualquier módulo que lea variables de entorno en su propio
// top-level (p.ej. @energy-bot/database arma el pool de Postgres al
// importarse) — por eso los demás imports son dinámicos y van dentro de
// main(), después de cargar el .env. Un `import` estático de esos módulos
// acá arriba se ejecutaría antes de este dotenv.config(), dejándolos sin
// las variables de entorno.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const main = async () => {
  // provider.saveFile() escribe acá pero no crea la carpeta si falta.
  fs.mkdirSync(path.resolve(import.meta.dirname, "../uploads"), { recursive: true });

  const qrcodeTerminal = (await import("qrcode-terminal")).default;
  const { createBot, createFlow, MemoryDB } = await import("@builderbot/bot");
  const { createBaileysProvider } = await import("./provider/baileys.provider.js");
  const { welcomeFlow } = await import("./flows/welcome.flow.js");
  const { receiptFlow } = await import("./flows/receipt.flow.js");
  const { applianceFlows } = await import("./flows/appliances.flow.js");
  const { planFlow } = await import("./flows/plan.flow.js");
  const { restartFlow } = await import("./flows/restart.flow.js");

  const provider = await createBaileysProvider();

  // BaileysProvider no imprime el QR por su cuenta: emite un evento
  // `require_action` con el QR crudo en `payload.qr` y espera que la app lo
  // muestre. Lo renderizamos como ASCII en la consola.
  provider.on("require_action", ({ payload }: { payload?: { qr?: string } }) => {
    if (payload?.qr) {
      qrcodeTerminal.generate(payload.qr, { small: true });
    }
  });

  const bot = await createBot({
    // restartFlow va primero: su keyword tiene que ganarle al WELCOME, que
    // atiende cualquier texto que no matchee otro flow.
    flow: createFlow([restartFlow, welcomeFlow, receiptFlow, ...applianceFlows, planFlow]),
    provider,
    // Estado interno de BuilderBot (historial de mensajes/flujo). La
    // persistencia real del negocio vive en Postgres vía @energy-bot/database.
    database: new MemoryDB(),
  });

  // httpServer es lo que efectivamente arranca el provider (initVendor):
  // sin esto, Baileys nunca intenta conectar y el QR jamás se emite.
  const port = Number(process.env.PORT) || 3000;
  bot.httpServer(port);

  console.log("🤖 Bot de ahorro energético corriendo. Escanea el QR con WhatsApp.");
};

main().catch((error) => {
  console.error("Error al iniciar el bot:", error);
  process.exit(1);
});
