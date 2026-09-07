import { ConversationStep } from "../conversation/conversation-state.service.js";
import { ApplianceType } from "./appliances.service.js";

/**
 * Configuración declarativa del cuestionario de electrodomésticos: única
 * fuente de verdad tanto para el flow de WhatsApp
 * (apps/bot/src/flows/appliances.flow.ts) como para el texto que ve la IA
 * al armar el plan (../plan/plan.service.ts). Agregar un electrodoméstico
 * nuevo es agregar un objeto a `APPLIANCE_QUESTIONS` (y su valor en
 * `ApplianceType`/`ConversationStep` si necesita un paso propio) — no hay
 * que tocar nada más para que ambos lados se enteren.
 */

export interface Validation {
  pattern: RegExp;
  feedback: string;
}

export interface TemplatePrompt {
  contentSid: string;
  variables?: Record<string, string>;
  fallbackText: string;
  fallbackOptions?: string[];
}

export interface TextQuestion {
  kind: "text";
  prompt: string;
  validation: Validation;
  field: "frequencyPerWeek" | "hoursPerDay";
}

export interface ListQuestion {
  kind: "list";
  template: TemplatePrompt;
  validation: Validation;
  overflow: {
    pattern: RegExp;
    prompt: string;
    validation: Validation;
  };
  /**
   * Pregunta que se hace después de resolver la frecuencia (por cualquiera
   * de las dos vías de arriba). Su respuesta se guarda junto con la
   * frecuencia en un solo `Appliance`.
   */
  then: TextQuestion;
}

export interface ApplianceQuestion {
  key: string;
  applianceType: ApplianceType;
  step: ConversationStep;
  gate: {
    template: TemplatePrompt;
    yes: RegExp;
    no: RegExp;
    feedback: string;
  };
  followUp: TextQuestion | ListQuestion;
  /**
   * Resumen en una sola frase de gate + followUp: es el texto que lee la IA
   * al armar el plan (ver `getApplianceQuestionText`), no lo que ve el
   * usuario por WhatsApp. Va en "tú" como el resto de los prompts a la IA:
   * con los prompts en voseo, el modelo llegó a contestarle "boludo" a un
   * usuario que mandó la foto equivocada.
   */
  aiQuestionText: string;
}

const YES_NO_CONTENT_SID = "HX5b31695abeec4ae5857f8c925b213c9d";
const YES = /^s[ií]$/i;
const NO = /^no$/i;
const YES_NO_FEEDBACK = "Respondé tocando *Sí* o *No*, por favor 🙏";

function yesNoGate(applianceLabel: string, fallbackText: string): ApplianceQuestion["gate"] {
  return {
    template: {
      contentSid: YES_NO_CONTENT_SID,
      variables: { "1": applianceLabel },
      fallbackText,
      fallbackOptions: ["Sí", "No"],
    },
    yes: YES,
    no: NO,
    feedback: YES_NO_FEEDBACK,
  };
}

const NUMERIC_FEEDBACK = "Necesito que me respondas con un *número*, por ejemplo: 3";

export const APPLIANCE_QUESTIONS: ApplianceQuestion[] = [
  {
    key: "aire",
    applianceType: ApplianceType.AIRE,
    step: ConversationStep.ASKING_AIRE,
    gate: yesNoGate("aire acondicionado", "❄️ ¿Tienes *aire acondicionado* en tu hogar?"),
    followUp: {
      kind: "list",
      template: {
        contentSid: "HX95ae8d68cb524ed16a648f8eb9d987a6",
        fallbackText: "¿Cuántos aires acondicionados tiene la vivienda?",
        fallbackOptions: ["1", "2", "3", "4", "5", "6", "7 o más"],
      },
      validation: {
        pattern: /^[1-6]$/,
        feedback: 'Seleccioná una opción de la lista: un número del 1 al 6, o "7 o más" 🙏',
      },
      overflow: {
        // El item "7 o más" de la lista de Twilio (HX95ae8d68cb524ed16a648f8eb9d987a6)
        // llega acá como body "7" — Twilio manda el id del item seleccionado,
        // no su texto ("7 o más"), así que el id ("7") es lo único confiable
        // para detectar esa opción. También matchea "7 o más"/números >=7
        // por si el usuario los escribe a mano en vez de tocar la lista.
        pattern: /^(7\s*o\s*m[aá]s|[7-9]|[1-9]\d+)$/i,
        prompt: "¿Cuántos exactamente?",
        validation: {
          pattern: /^([7-9]|[1-9]\d+)$/,
          feedback: "Necesito un número igual o mayor a 7, por ejemplo: 8",
        },
      },
      then: {
        kind: "text",
        prompt: "¿Cuántas horas al día lo usas en promedio?",
        validation: {
          pattern: /^([1-9]|1\d|2[0-4])$/,
          feedback: "Necesito el número de horas, entre 1 y 24, por ejemplo: 6",
        },
        field: "hoursPerDay",
      },
    },
    aiQuestionText:
      "¿Tienes aire acondicionado? ¿Cuántas veces a la semana lo usas y cuántas horas al día en promedio?",
  },
  {
    key: "plancha",
    applianceType: ApplianceType.PLANCHA,
    step: ConversationStep.ASKING_PLANCHA,
    gate: yesNoGate("plancha de ropa", "👕 ¿Tienes *plancha de ropa* en tu hogar?"),
    followUp: {
      kind: "text",
      prompt: "¿Cuántas veces a la semana la usas?",
      validation: { pattern: /^\d{1,2}$/, feedback: NUMERIC_FEEDBACK },
      field: "frequencyPerWeek",
    },
    aiQuestionText: "¿Tienes plancha? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "horno",
    applianceType: ApplianceType.HORNO_AIRFRYER,
    step: ConversationStep.ASKING_HORNO,
    gate: yesNoGate(
      "horno eléctrico o freidora de aire",
      "🍟 ¿Tienes *horno eléctrico* o *freidora de aire (air fryer)* en tu hogar?"
    ),
    followUp: {
      kind: "text",
      prompt: "¿Cuántas veces a la semana lo usas?",
      validation: { pattern: /^\d{1,2}$/, feedback: NUMERIC_FEEDBACK },
      field: "frequencyPerWeek",
    },
    aiQuestionText:
      "¿Tienes horno eléctrico o freidora de aire (air fryer)? ¿Cuántas veces a la semana lo usas?",
  },
];

/**
 * Texto en lenguaje natural de la pregunta de un electrodoméstico, para el
 * prompt que arma el plan con la IA (ver plan.service.ts). Lanza si `type`
 * no tiene entrada en `APPLIANCE_QUESTIONS`, lo que sólo puede pasar si
 * `ApplianceType` se extiende sin agregar su objeto acá.
 */
export function getApplianceQuestionText(type: ApplianceType): string {
  const question = APPLIANCE_QUESTIONS.find((q) => q.applianceType === type);
  if (!question) {
    throw new Error(`No hay pregunta configurada para el tipo de electrodoméstico "${type}"`);
  }
  return question.aiQuestionText;
}
