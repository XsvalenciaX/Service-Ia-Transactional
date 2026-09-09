import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import dotenv from "dotenv";

// Mismo motivo que en index.ts: el .env de la raíz tiene que cargarse ANTES
// de importar @energy-bot/services (arma el pool de Postgres al importarse),
// por eso el resto de los imports son dinámicos dentro de main().
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

const UPLOADS_DIR = path.resolve(import.meta.dirname, "../../uploads");
const HTML_PATH = path.resolve(import.meta.dirname, "simulator.html");
const DEFAULT_PHONE = "573000000001";
// 3000 es del bot real (`pnpm dev`), así que el simulador arranca más arriba
// y, si el puerto está tomado, sigue probando los siguientes.
const PORT = Number(process.env.SIM_PORT) || 3100;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

interface IncomingMessage {
  from: string;
  body: string;
  name: string;
}

interface ProviderEmitter {
  emit(event: string, payload: IncomingMessage): void;
}

interface OutgoingMessage {
  type: "message" | "error";
  text: string;
  buttons: string[];
}

const main = async () => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const { createBot, createFlow, createProvider, MemoryDB, TestTool, EVENTS } =
    await import("@builderbot/bot");
  const { conversationStateService } = await import("@energy-bot/services");
  const { welcomeFlow } = await import("../flows/welcome.flow.js");
  const { receiptFlow } = await import("../flows/receipt.flow.js");
  const { manualConsumptionFlow } = await import("../flows/manual-consumption.flow.js");
  const { applianceFlows } = await import("../flows/appliances.flow.js");
  const { planFlow } = await import("../flows/plan.flow.js");
  const { restartFlow } = await import("../flows/restart.flow.js");

  // Conexiones SSE abiertas, indexadas por el número que simula cada pestaña,
  // para poder tener varios chats en paralelo.
  const clients = new Map<string, http.ServerResponse[]>();

  const push = (phone: string, payload: OutgoingMessage) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    const vivos: http.ServerResponse[] = [];

    for (const res of clients.get(phone) ?? []) {
      // Una pestaña que se cerró justo antes de este push deja el socket
      // muerto; escribirle tira y, si eso pasa dentro del handler de
      // unhandledRejection, se lleva puesto el simulador entero.
      if (res.writableEnded || res.destroyed) {
        continue;
      }
      try {
        res.write(data);
        vivos.push(res);
      } catch {
        // no-op: se cae de `vivos`, que reemplaza la lista al final.
      }
    }

    clients.set(phone, vivos);
  };

  // TestProvider es el provider mock que trae BuilderBot: no habla con
  // WhatsApp, solo emite y recibe eventos en memoria. Le agregamos lo justo
  // para que los flows se comporten igual que con Baileys.
  class WebProvider extends TestTool.TestProvider {
    // Última imagen subida por cada número, a la espera de que el receipt
    // flow la pida vía saveFile().
    pendingImages = new Map<string, string>();

    // Inyecta un mensaje entrante: es lo mismo que hace delaySendMessage()
    // del TestProvider (delay + emit del evento que escucha el core).
    // El cast es porque los tipos de @builderbot/bot no resuelven
    // ProviderClass (su .d.ts importa polka y termina en `any`), así que la
    // clase base llega sin miembros y el emit heredado hay que nombrarlo.
    receive(payload: IncomingMessage): void {
      (this as unknown as ProviderEmitter).emit("message", payload);
    }

    async saveFile(ctx: { from: string }): Promise<string> {
      const source = this.pendingImages.get(ctx.from);
      if (!source) {
        throw new Error("No hay ninguna imagen pendiente para este número.");
      }
      this.pendingImages.delete(ctx.from);
      return source;
    }

    async sendMessage(
      userId: string,
      message: string,
      options?: { options?: { buttons?: { body: string }[] } }
    ): Promise<unknown> {
      push(userId, {
        type: "message",
        text: message,
        buttons: (options?.options?.buttons ?? []).map((b) => b.body),
      });
      return { userId, message };
    }
  }

  const provider = createProvider<WebProvider>(WebProvider);

  // Sin bot.httpServer(): CoreClass se suscribe a los eventos del provider en
  // su constructor y TestProvider no necesita arrancar nada, así que el
  // simulador no pelea por el puerto 3000 con `pnpm dev`.
  await createBot({
    // Mismo orden que en index.ts: restartFlow tiene que ganarle al WELCOME.
    flow: createFlow([
      restartFlow,
      welcomeFlow,
      receiptFlow,
      manualConsumptionFlow,
      ...applianceFlows,
      planFlow,
    ]),
    provider,
    database: new MemoryDB(),
  });

  const readJsonBody = (req: http.IncomingMessage): Promise<Record<string, string>> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("La imagen es demasiado grande (máx. 20 MB)."));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("Body inválido."));
        }
      });
      req.on("error", reject);
    });

  const saveDataUrl = (phone: string, filename: string, dataUrl: string): void => {
    const match = /^data:(image\/[a-z+]+);base64,(.+)$/is.exec(dataUrl);
    if (!match) {
      throw new Error("Solo se aceptan imágenes.");
    }
    const ext = path.extname(filename) || `.${match[1].split("/")[1]}`;
    const dest = path.join(UPLOADS_DIR, `sim-${Date.now()}${ext}`);
    fs.writeFileSync(dest, Buffer.from(match[2], "base64"));
    provider.pendingImages.set(phone, dest);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(HTML_PATH));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/session") {
        // Cada chat estrena número, y por lo tanto un User nuevo con su
        // ConversationState en WELCOME. Si reusáramos siempre el mismo, al
        // segundo intento el usuario ya estaría en COMPLETED y welcomeFlow
        // cortaría con endFlow() sin responder nada (parecería que el bot
        // está colgado). También evita arrastrar el capture pendiente que
        // BuilderBot guarda en memoria por número.
        const phone = `5730${Date.now().toString().slice(-8)}`;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ phone }));
        return;
      }

      // El paso en el que va la conversación, para mostrarlo en el header:
      // hace evidente por qué el bot responde lo que responde.
      if (req.method === "GET" && url.pathname === "/api/state") {
        const phone = url.searchParams.get("phone") ?? DEFAULT_PHONE;
        const { state } = await conversationStateService.getOrCreateSession(phone);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ step: state.currentStep }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/stream") {
        const phone = url.searchParams.get("phone") ?? DEFAULT_PHONE;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": conectado\n\n");

        const list = clients.get(phone) ?? [];
        list.push(res);
        clients.set(phone, list);

        req.on("close", () => {
          clients.set(
            phone,
            (clients.get(phone) ?? []).filter((client) => client !== res)
          );
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/message") {
        const body = await readJsonBody(req);
        provider.receive({
          from: body.phone,
          body: body.text,
          name: "Tester",
        });
        res.writeHead(204).end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/image") {
        const body = await readJsonBody(req);
        saveDataUrl(body.phone, body.filename ?? "recibo.jpg", body.dataUrl);
        // Baileys reescribe ctx.body con esta referencia cuando el mensaje
        // entrante es una imagen; es lo que dispara addKeyword(EVENTS.MEDIA).
        provider.receive({
          from: body.phone,
          body: EVENTS.MEDIA,
          name: "Tester",
        });
        res.writeHead(204).end();
        return;
      }

      res.writeHead(404).end("No encontrado");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(message);
    }
  });

  // Un flow que explota (p.ej. Postgres caído) no puede tumbar el simulador:
  // lo mostramos en el chat y seguimos.
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("Error en un flow:", reason);
    for (const phone of [...clients.keys()]) {
      push(phone, { type: "error", text: message, buttons: [] });
    }
  });

  // Última red: el simulador es una herramienta de desarrollo y es preferible
  // que siga en pie con el error a la vista antes que morirse a mitad de una
  // prueba y dejar el puerto tomado.
  process.on("uncaughtException", (error) => {
    console.error("Excepción no capturada (el simulador sigue vivo):", error);
  });

  // En Windows dos procesos pueden quedar escuchando el mismo puerto en
  // interfaces distintas (0.0.0.0 y ::1) sin que salte EADDRINUSE, y las
  // requests se las lleva el otro. Escuchando solo en 127.0.0.1 el conflicto
  // sí se detecta y podemos pasar al siguiente puerto.
  const listen = (port: number, attemptsLeft: number): void => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
        console.log(`   (puerto ${port} ocupado, probando ${port + 1}…)`);
        listen(port + 1, attemptsLeft - 1);
        return;
      }
      throw error;
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`\n💬 Simulador del bot en http://localhost:${port}`);
      console.log("   Escribí ahí como si fuera WhatsApp. Ctrl+C para salir.\n");
    });
  };

  listen(PORT, 20);
};

main().catch((error) => {
  console.error("Error al iniciar el simulador:", error);
  process.exit(1);
});
