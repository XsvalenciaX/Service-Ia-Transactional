import { ConversationStep } from "../conversation/conversation-state.service.js";
import { ApplianceType } from "./appliances.service.js";

/**
 * Configuración declarativa del cuestionario de electrodomésticos: única
 * fuente de verdad tanto para el flow de WhatsApp
 * (apps/bot/src/flows/appliances.flow.ts) como para el texto que ve la IA
 * al armar el plan (../plan/plan.service.ts). Agregar un electrodoméstico
 * nuevo es agregar un objeto a `APPLIANCE_QUESTIONS` (y su valor en
 * `ApplianceType`/`ConversationStep`) — no hay que tocar nada más para que
 * ambos lados se enteren.
 *
 * Todos se preguntan primero desde una sola pantalla de selección múltiple
 * de Twilio (`appliance_selection`, twilio/flows, ver
 * scripts/create-appliance-selection-content.mjs): `key` acá coincide con
 * el `id` que se usó como opción en esa pantalla. `followUp` es la
 * pregunta de seguimiento (cantidad/frecuencia) que se dispara sólo para
 * los que el usuario marcó ahí.
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
  followUp: TextQuestion | ListQuestion;
  /**
   * Resumen en una sola frase de la pregunta: es el texto que lee la IA al
   * armar el plan (ver `getApplianceQuestionText`), no lo que ve el
   * usuario por WhatsApp. Va en "tú" como el resto de los prompts a la IA:
   * con los prompts en voseo, el modelo llegó a contestarle "boludo" a un
   * usuario que mandó la foto equivocada.
   */
  aiQuestionText: string;
}

const NUMERIC_FEEDBACK = "Necesito que me respondas con un *número*, por ejemplo: 3";

function frequencyFollowUp(prompt: string): TextQuestion {
  return {
    kind: "text",
    prompt,
    validation: { pattern: /^\d{1,2}$/, feedback: NUMERIC_FEEDBACK },
    field: "frequencyPerWeek",
  };
}

// Template compartido de lista (scripts/create-appliance-quantity-list-content.mjs):
// "¿Cuántos {{1}} tiene la vivienda?", parametrizado en vez de un Content
// por electrodoméstico (aire, tv, ventilador y los que se agreguen).
const APPLIANCE_QUANTITY_CONTENT_SID = "HXfd6c127d25adf2a98b60008a98e22178";

/**
 * Cantidad (lista 1-6 + overflow "7 o más") y horas/día de uso: mismo
 * patrón que ya usaba el aire, ahora también para tv, ventilador y
 * cualquier electrodoméstico nuevo que necesite "cuántos tienes".
 */
function quantityAndHoursFollowUp(options: {
  pluralLabel: string;
  fallbackText: string;
}): ListQuestion {
  return {
    kind: "list",
    template: {
      contentSid: APPLIANCE_QUANTITY_CONTENT_SID,
      variables: { "1": options.pluralLabel },
      fallbackText: options.fallbackText,
      fallbackOptions: ["1", "2", "3", "4", "5", "6", "7 o más"],
    },
    validation: {
      pattern: /^[1-6]$/,
      feedback: 'Selecciona una opción de la lista: un número del 1 al 6, o "7 o más" 🙏',
    },
    overflow: {
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
  };
}

export const APPLIANCE_QUESTIONS: ApplianceQuestion[] = [
  {
    key: "aire",
    applianceType: ApplianceType.AIRE,
    step: ConversationStep.ASKING_AIRE,
    followUp: quantityAndHoursFollowUp({
      pluralLabel: "aires acondicionados",
      fallbackText: "¿Cuántos aires acondicionados tiene la vivienda?",
    }),
    aiQuestionText:
      "¿Tienes aire acondicionado? ¿Cuántas veces a la semana lo usas y cuántas horas al día en promedio?",
  },
  {
    key: "plancha",
    applianceType: ApplianceType.PLANCHA,
    step: ConversationStep.ASKING_PLANCHA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la plancha de ropa?"),
    aiQuestionText: "¿Tienes plancha? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "horno",
    applianceType: ApplianceType.HORNO_AIRFRYER,
    step: ConversationStep.ASKING_HORNO,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas el horno / air fryer?"),
    aiQuestionText:
      "¿Tienes horno eléctrico o freidora de aire (air fryer)? ¿Cuántas veces a la semana lo usas?",
  },
  {
    key: "lavadora",
    applianceType: ApplianceType.LAVADORA,
    step: ConversationStep.ASKING_LAVADORA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la lavadora?"),
    aiQuestionText: "¿Tienes lavadora de ropa? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "secadora_gas",
    applianceType: ApplianceType.SECADORA_GAS,
    step: ConversationStep.ASKING_SECADORA_GAS,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la secadora?"),
    aiQuestionText: "¿Tienes secadora de ropa a gas? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "tv",
    applianceType: ApplianceType.TV,
    step: ConversationStep.ASKING_TV,
    followUp: quantityAndHoursFollowUp({
      pluralLabel: "televisores",
      fallbackText: "¿Cuántos televisores tiene la vivienda?",
    }),
    aiQuestionText:
      "¿Tienes televisor? ¿Cuántos tienes y cuántas horas al día los usas en promedio?",
  },
  {
    key: "ventilador",
    applianceType: ApplianceType.VENTILADOR,
    step: ConversationStep.ASKING_VENTILADOR,
    followUp: quantityAndHoursFollowUp({
      pluralLabel: "ventiladores",
      fallbackText: "¿Cuántos ventiladores tiene la vivienda?",
    }),
    aiQuestionText:
      "¿Tienes ventilador? ¿Cuántos tienes y cuántas horas al día los usas en promedio?",
  },
  {
    key: "secador_pelo",
    applianceType: ApplianceType.SECADOR_PELO,
    step: ConversationStep.ASKING_SECADOR_PELO,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas el secador de pelo?"),
    aiQuestionText: "¿Tienes secador de pelo? ¿Cuántas veces a la semana lo usas?",
  },
  {
    key: "plancha_pelo",
    applianceType: ApplianceType.PLANCHA_PELO,
    step: ConversationStep.ASKING_PLANCHA_PELO,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la plancha de pelo?"),
    aiQuestionText: "¿Tienes plancha de pelo? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "arrocera",
    applianceType: ApplianceType.ARROCERA,
    step: ConversationStep.ASKING_ARROCERA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la arrocera?"),
    aiQuestionText: "¿Tienes arrocera? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "calentador_agua",
    applianceType: ApplianceType.CALENTADOR_AGUA,
    step: ConversationStep.ASKING_CALENTADOR_AGUA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas el calentador de agua?"),
    aiQuestionText: "¿Tienes calentador de agua eléctrico? ¿Cuántas veces a la semana lo usas?",
  },
  {
    key: "licuadora",
    applianceType: ApplianceType.LICUADORA,
    step: ConversationStep.ASKING_LICUADORA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la licuadora?"),
    aiQuestionText: "¿Tienes licuadora? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "estufa_electrica",
    applianceType: ApplianceType.ESTUFA_ELECTRICA,
    step: ConversationStep.ASKING_ESTUFA_ELECTRICA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la estufa eléctrica?"),
    aiQuestionText: "¿Tienes estufa eléctrica? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "calefactor",
    applianceType: ApplianceType.CALEFACTOR,
    step: ConversationStep.ASKING_CALEFACTOR,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas el calefactor?"),
    aiQuestionText: "¿Tienes calefactor de ambiente? ¿Cuántas veces a la semana lo usas?",
  },
  {
    key: "lavaplatos",
    applianceType: ApplianceType.LAVAPLATOS,
    step: ConversationStep.ASKING_LAVAPLATOS,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la máquina lavaplatos?"),
    aiQuestionText: "¿Tienes máquina lavaplatos? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "consola",
    applianceType: ApplianceType.CONSOLA,
    step: ConversationStep.ASKING_CONSOLA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la consola de videojuegos?"),
    aiQuestionText: "¿Tienes consola de videojuegos? ¿Cuántas veces a la semana la usas?",
  },
  {
    key: "sonido",
    applianceType: ApplianceType.SONIDO,
    step: ConversationStep.ASKING_SONIDO,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas el equipo de sonido?"),
    aiQuestionText: "¿Tienes equipo de sonido de alta potencia? ¿Cuántas veces a la semana lo usas?",
  },
  {
    key: "microondas",
    applianceType: ApplianceType.MICROONDAS,
    step: ConversationStep.ASKING_MICROONDAS,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas el microondas?"),
    aiQuestionText: "¿Tienes horno microondas? ¿Cuántas veces a la semana lo usas?",
  },
  {
    key: "aspiradora",
    applianceType: ApplianceType.ASPIRADORA,
    step: ConversationStep.ASKING_ASPIRADORA,
    followUp: frequencyFollowUp("¿Cuántos días de la semana usas la aspiradora?"),
    aiQuestionText: "¿Tienes aspiradora? ¿Cuántas veces a la semana la usas?",
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
