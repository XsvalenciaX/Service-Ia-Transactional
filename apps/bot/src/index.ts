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

  const { createBot, createFlow, MemoryDB } = await import("@builderbot/bot");
  const { provider } = await import("./provider/twilio.provider.js");
  const { welcomeFlow } = await import("./flows/welcome.flow.js");
  const { receiptFlow } = await import("./flows/receipt.flow.js");
  const { manualConsumptionFlow } = await import("./flows/manual-consumption.flow.js");
  const { applianceFlows } = await import("./flows/appliances.flow.js");
  const { planFlow } = await import("./flows/plan.flow.js");
  const { restartFlow } = await import("./flows/restart.flow.js");

  const bot = await createBot({
    // restartFlow va primero: su keyword tiene que ganarle al WELCOME, que
    // atiende cualquier texto que no matchee otro flow.
    flow: createFlow([
      restartFlow,
      welcomeFlow,
      receiptFlow,
      manualConsumptionFlow,
      ...applianceFlows,
      planFlow,
    ]),
    provider,
    // Estado interno de BuilderBot (historial de mensajes/flujo). La
    // persistencia real del negocio vive en Postgres vía @energy-bot/database.
    database: new MemoryDB(),
  });

  // httpServer es lo que efectivamente arranca el provider (initVendor) y
  // registra el webhook de Twilio (POST /webhook) en este mismo puerto.
  const port = Number(process.env.PORT) || 3000;
  bot.httpServer(port);

  console.log(
    `🤖 Bot de ahorro energético corriendo. Webhook de Twilio: POST http://localhost:${port}/webhook`
  );
};

main().catch((error) => {
  console.error("Error al iniciar el bot:", error);
  process.exit(1);
});
