import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Crea el Content de Twilio compartido "ask_appliance_quantity"
 * (twilio/list-picker) que usan todos los electrodomésticos que preguntan
 * "cuántos tenés" (aire, tv, ventilador, y los que se agreguen después) --
 * mismo patrón que YES_NO_CONTENT_SID en appliance-questions.ts: un solo
 * template parametrizado con {{1}} en vez de uno por electrodoméstico.
 *
 * El aire ya tenía su propio template dedicado (HX95ae8d68cb524ed16a648f8eb9d987a6,
 * "¿Cuántos aires acondicionados tiene la vivienda?", sin variable) creado
 * antes de este script -- se deja como está porque ya puede estar aprobado
 * y en uso; este Content nuevo es sólo para los electrodomésticos que se
 * agreguen de ahora en más.
 *
 * Uso: node scripts/create-appliance-quantity-list-content.mjs [--dry-run]
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

const items = ["1", "2", "3", "4", "5", "6"].map((n) => ({ id: n, item: n }));
items.push({ id: "7", item: "7 o más" });

export const APPLIANCE_QUANTITY_LIST_PAYLOAD = {
  friendly_name: "ask_appliance_quantity",
  language: "es_MX",
  variables: { "1": "televisores" },
  types: {
    "twilio/list-picker": {
      body: "¿Cuántos {{1}} tiene la vivienda?",
      button: "Seleccionar",
      items,
    },
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log(JSON.stringify(APPLIANCE_QUANTITY_LIST_PAYLOAD, null, 2));
    process.exit(0);
  }

  const res = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(APPLIANCE_QUANTITY_LIST_PAYLOAD),
  });

  const json = await res.json();
  console.log("HTTP", res.status);
  console.log(JSON.stringify(json, null, 2));
}
