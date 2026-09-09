import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Crea (o recrea) el Content de Twilio "appliance_selection"
 * (twilio/flows, tipo de componente MULTIPLE_SELECT) que usa
 * apps/bot/src/flows/appliances.flow.ts para preguntar de una sola vez
 * qué electrodomésticos tiene el usuario, en vez de un yes/no por cada
 * uno.
 *
 * El tipo de componente correcto es "MULTIPLE_SELECT": no está así en la
 * documentación pública de Twilio (que sugiere "MULTI_SELECT", que no
 * existe) -- se confirmó inspeccionando por API un content creado a mano
 * desde la consola. `name` es la clave con la que esa página aparece en
 * el `InteractiveData` del webhook cuando el usuario responde, por eso se
 * fija explícito en vez de dejarlo en null.
 *
 * Los Content de Twilio son inmutables una vez creados: correr este
 * script de nuevo NO actualiza el "appliance_selection" existente, crea
 * un Content nuevo con un SID nuevo. Para agregar un electrodoméstico:
 * 1. Agregá la entrada a la página que corresponda (o una página nueva).
 * 2. Corré `node scripts/create-appliance-selection-content.mjs`.
 * 3. Actualizá el contentSid en el código con el SID nuevo que devuelve.
 * 4. Mandá el content nuevo a revisión de WhatsApp
 *    (POST {sid}/ApprovalRequests/whatsapp, category UTILITY) antes de
 *    usarlo en producción -- twilio/flows requiere aprobación siempre,
 *    incluso respondiendo dentro de una sesión de 24hs ya iniciada.
 * 5. Borrá el Content viejo si ya no lo usa nada (DELETE /v1/Content/{sid}).
 *
 * Uso: node scripts/create-appliance-selection-content.mjs [--dry-run]
 */

function loadEnv(path) {
  const env = {};
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = loadEnv(join(__dirname, "..", ".env"));
const ACCOUNT_SID = env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = env.TWILIO_AUTH_TOKEN;

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error("Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en .env");
  process.exit(1);
}

function multipleSelect({ name, label, options, required = false }) {
  return {
    type: "MULTIPLE_SELECT",
    name,
    label,
    required,
    options: JSON.stringify(options.map(([id, title]) => ({ id, title }))),
  };
}

// El `id` de cada opción es la key que después usa APPLIANCE_QUESTIONS
// (packages/services/src/appliances/appliance-questions.ts) para saber
// qué preguntas de seguimiento (cantidad/frecuencia) disparar.
const pages = [
  {
    id: "climatizacion",
    title: "Climatización",
    next_page_id: "cocina",
    layout: [
      multipleSelect({
        name: "climatizacion",
        label: "¿Cuáles de estos tienes y usas frecuentemente?",
        options: [
          ["aire", "Aire acondicionado"],
          ["ventilador", "Ventilador"],
          ["calefactor", "Calefactor"],
          ["calentador_agua", "Calentador eléctrico de agua"],
        ],
      }),
    ],
  },
  {
    id: "cocina",
    title: "Cocina",
    next_page_id: "lavado",
    layout: [
      multipleSelect({
        name: "cocina",
        label: "¿Cuáles de estos tienes y usas frecuentemente?",
        options: [
          ["horno", "Horno eléctrico / air fryer"],
          ["microondas", "Horno microondas"],
          ["arrocera", "Arrocera"],
          ["licuadora", "Licuadora"],
          ["lavaplatos", "Máquina lavaplatos"],
          ["estufa_electrica", "Estufa eléctrica"],
        ],
      }),
    ],
  },
  {
    id: "lavado",
    title: "Lavado y limpieza",
    next_page_id: "cuidado_personal",
    layout: [
      multipleSelect({
        name: "lavado",
        label: "¿Cuáles de estos tienes y usas frecuentemente?",
        options: [
          ["lavadora", "Lavadora de ropa"],
          ["secadora_gas", "Secadora a gas"],
          ["plancha", "Plancha de ropa"],
          ["aspiradora", "Aspiradora"],
        ],
      }),
    ],
  },
  {
    id: "cuidado_personal",
    title: "Cuidado personal",
    next_page_id: "otros",
    layout: [
      multipleSelect({
        name: "cuidado_personal",
        label: "¿Cuáles de estos tienes y usas frecuentemente?",
        options: [
          ["secador_pelo", "Secador de pelo"],
        ],
      }),
    ],
  },
  {
    id: "otros",
    title: "Entretenimiento y otros",
    next_page_id: null,
    layout: [
      multipleSelect({
        name: "otros",
        label: "¿Cuáles de estos tienes y usas frecuentemente?",
        options: [
          ["tv", "Televisor"],
          ["consola", "Consola de juegos"],
          ["sonido", "Equipo de sonido de alta potencia"],
        ],
      }),
    ],
  },
];

export const APPLIANCE_SELECTION_FLOW_PAYLOAD = {
  friendly_name: "appliance_selection_v5",
  language: "es_MX",
  types: {
    "twilio/flows": {
      body: "Antes de armar tu plan de ahorro, cuéntanos qué electrodomésticos tienes en casa. Selecciona todos los que correspondan.",
      button_text: "Elegir",
      // Sin emoji: WhatsApp rechaza la aprobación de un twilio/flows si el
      // subtitle lleva emoji o saltos de línea (error 400 confirmado al
      // mandar ApprovalRequests con "🔒" en v4).
      subtitle: "Uso esto solo para calcular tu plan de ahorro.",
      type: "OTHER",
      pages,
    },
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log(JSON.stringify(APPLIANCE_SELECTION_FLOW_PAYLOAD, null, 2));
    process.exit(0);
  }

  const res = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(APPLIANCE_SELECTION_FLOW_PAYLOAD),
  });

  const json = await res.json();
  console.log("HTTP", res.status);
  console.log(JSON.stringify(json, null, 2));
}
