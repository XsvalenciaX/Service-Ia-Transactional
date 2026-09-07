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

  // Twilio manda el número del usuario en `From`. Si llega algo que no es un
  // teléfono (una prueba manual del webhook, un callback de estado, un canal
  // mal configurado), el envío de la respuesta falla con el error 21211 de
  // Twilio. Loguearlo acá deja ver el valor exacto que llegó.
  provider.on("message", (ctx: { from?: string; name?: string; body?: string }) => {
    const numero = ctx.from ?? "";
    const esTelefono = /^\d{7,15}$/.test(numero);

    console.log(
      `📩 [entrante] from=${JSON.stringify(numero)}${
        esTelefono ? "" : "  ⚠️ NO parece un teléfono E.164"
      } name=${JSON.stringify(ctx.name)} body=${JSON.stringify(
        ctx.body?.slice(0, 60)
      )}`
    );
  });

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

// BuilderBot manda las respuestas fuera del await de los flows, así que un
// rechazo del proveedor (un número inválido, un corte de red con Twilio)
// llega como unhandledRejection y, sin esto, tumba el proceso entero: una
// sola conversación rota dejaría al bot caído para todos los demás.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Error no capturado al procesar un mensaje:", reason);
});

process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
  // Un puerto ocupado no es un error del que se pueda seguir: el bot quedaría
  // "vivo" pero sin webhook, que se ve igual que un bot que no responde.
  // Mejor morir con un mensaje claro que fingir que arrancó.
  if (error.code === "EADDRINUSE") {
    const port = Number(process.env.PORT) || 3000;
    console.error(
      `\n❌ El puerto ${port} ya está ocupado por otro proceso.\n` +
        `   Cerrá el bot que tengas corriendo y volvé a intentar.\n` +
        `   Para encontrarlo:  netstat -ano | findstr :${port}\n` +
        `   Para cerrarlo:     taskkill /PID <pid> /F\n`
    );
    process.exit(1);
  }

  console.error("⚠️ Excepción no capturada (el bot sigue corriendo):", error);
});

main().catch((error) => {
  console.error("Error al iniciar el bot:", error);
  process.exit(1);
});
