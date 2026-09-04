# Integración con IA

Proveedor: **Anthropic (Claude)**, vía el SDK oficial `@anthropic-ai/sdk`.

- API key: `AI_PROVIDER_API_KEY` en el `.env` de la raíz (se acepta también
  `ANTHROPIC_API_KEY`). Se saca de <https://console.anthropic.com/settings/keys>.
- Modelo: `AI_MODEL`, por defecto **`claude-haiku-4-5`** — el más barato del
  catálogo que entiende imágenes (USD 1 por millón de tokens de entrada, 5 de
  salida), que es lo que hace falta para leer la foto de un recibo. Para más
  precisión: `claude-sonnet-5` o `claude-opus-5`, sin tocar código.

El cliente vive en `src/shared/ai.ts` y se crea **la primera vez que se lo usa**,
no al importar el módulo: el bot importa estos servicios al arrancar y, si no,
no podría levantar ni mostrar el QR sin la API key configurada.

Las dos llamadas son de un solo turno, sin thinking ni tool use: son tareas de
un paso y así la prueba sale lo más barata posible.

## 1. Leer el recibo

**Archivo:** `src/receipt/receipt.service.ts` -> `analyzeReceiptWithModel()`

Manda la foto del recibo (bloque de imagen en base64) + `ANALYSIS_PROMPT`, con
`ANALYSIS_SYSTEM` como system prompt, y espera de vuelta el
`ReceiptAnalysisResult` en JSON: `valid`, `recommendation` (si no se pudo leer),
`consumptionKwh`, `averageConsumptionKwh`, `amount`, `currency`, `periodStart`,
`periodEnd`.

El system prompt le prohíbe inventar valores: si un dato no se ve en la foto, lo
omite en vez de estimarlo. Para `averageConsumptionKwh` la regla es más estricta
todavía — tiene que estar impreso en la factura (el recuadro de "promedio últimos
6 meses" o el gráfico del historial), nunca calculado a partir del consumo del
período.

**Si la foto no es una factura o falta el promedio**, `receipt.flow.ts` responde
"No logramos identificar el consumo, por favor digita el valor en kWh", suma un
intento en `ConversationState.receiptAttempts` y deja al usuario en
`AWAITING_RECEIPT`. Hasta el tercer intento ofrece las dos salidas (otra foto de la
factura completa o el número a mano); del tercero en adelante pide solamente el
número, porque hay facturas que no traen el promedio impreso y no tiene sentido
seguir pidiendo fotos.

El número escrito a mano lo atiende `welcome.flow.ts` (el catch-all): mientras el
paso sea `AWAITING_RECEIPT`, un mensaje con cifras se interpreta como el consumo
promedio. Lo parsea `extractKwh()` — entiende "265", "265 kwh", "1.250" — y
`isPlausibleConsumption()` descarta lo que no puede ser un consumo mensual
(fuera de 10–20.000 kWh), para no armar el plan sobre el total a pagar. Se guarda
con `registerManualAverageConsumption()`, que marca el registro con
`source: "manual"`.

**Tono:** los tres system prompts están escritos en español neutro y piden respuestas
en español colombiano tratando al usuario de "tú", con prohibición explícita de
insultos y modismos de otros países. No es cosmético: con los prompts escritos en
voseo rioplatense, el modelo llegó a contestarle "boludo" a un usuario que mandó la
foto equivocada.

## 2. Generar el plan

**Archivo:** `src/plan/plan.service.ts` -> `generatePlanContent()`

Manda el `context` que arma `buildPlanGenerationRequest()` — los datos extraídos
del recibo + las preguntas y respuestas sobre electrodomésticos — más la imagen
original del recibo si sigue en disco, y espera el `SavingsPlanContent` en JSON:
`targetReductionPercent`, `summary`, `recommendations`.

`PLAN_SYSTEM` obliga a que cada recomendación se apoye en esos datos concretos
(el electrodoméstico y la frecuencia que el usuario declaró, el consumo del
recibo) y a no recomendar nada sobre un electrodoméstico que el usuario dijo no
tener.

## 3. Responder preguntas fuera de guion

**Archivo:** `src/assistant/assistant.service.ts` -> `answerQuestion()`

Lo llama `welcomeFlow` (el catch-all de BuilderBot) cuando el usuario escribe algo
que no era lo que el bot estaba esperando. Le manda el mensaje más el contexto del
propio usuario — su recibo, sus electrodomésticos, su plan y en qué paso está — y
recibe `{ onTopic, reply }`:

- **Del tema** (su plan, su factura, o energía en general: cuánto vale el kWh, qué
  electrodoméstico gasta más, por qué subió la tarifa): responde con sus datos
  concretos. Ante la duda, el prompt le dice que asuma que la pregunta es del tema.
- **Fuera del tema** (deportes, chistes, recetas, otros servicios): no la responde ni
  en parte, avisa que de eso no puede ayudar y reconduce hacia lo que sí hace,
  proponiendo algo concreto de los datos del usuario.

Como el prompt recibe el paso actual, la respuesta cierra encarrilando: si todavía no
mandó el recibo, se lo vuelve a pedir.

El contexto también lleva **la fecha de hoy y el estado mensual del plan**
(`planService.getMonthlyPlanStatus`), para que responda bien a "¿me haces otro plan?".
Sin la fecha el modelo inventa el mes: llegó a contestar "el próximo lo hacemos en
septiembre" estando en septiembre.

Corre en todos los pasos. En `AWAITING_RECEIPT` y `COMPLETED` entra por el
catch-all; durante las preguntas de electrodomésticos el `capture` se queda con el
mensaje antes que nadie, así que `appliances.flow.ts` decide con
`looksLikeQuestion()` (en `apps/bot/src/utils/message-validation.ts`) si eso que
escribió el usuario era una respuesta o una pregunta, y en el segundo caso responde
y vuelve a hacer la pregunta del paso con `fallBack`, sin perder el lugar.

Esa decisión es una heurística local (signos de interrogación, palabras
interrogativas, y la regla de que un mensaje con números es una respuesta) y no una
llamada al modelo, a propósito: clasificar cada respuesta con la IA duplicaría el
costo de una conversación, y la enorme mayoría de los mensajes en esos pasos son
respuestas normales.

## Cuando la IA no está disponible

Todo lo que puede fallar (falta de API key, key inválida, rate limit, imagen
demasiado pesada, respuesta no parseable) sale como `AiError` desde
`src/shared/ai.ts`, para poder distinguirlo de un bug. Los tres servicios lo
capturan y degradan en vez de cortar la conversación:

- **Recibo:** devuelve `valid: false` con una explicación. El flow ya sabe pedir
  la foto de nuevo y el usuario se queda en `AWAITING_RECEIPT`.
- **Preguntas fuera de guion:** responde que en ese momento no puede.
- **Plan:** guarda un plan genérico con estado **`PENDIENTE`** (en vez de
  `GENERADO`), que es la marca de que hay que regenerarlo. El flow avisa que no
  se pudo personalizar y sugiere `reiniciar`.

En los dos casos el motivo real queda en la consola del servidor
(`[receipt] falló...` / `[plan] falló...`).

## Cómo probarlo

Con `AI_PROVIDER_API_KEY` cargada, `pnpm sim` y adjuntá una foto de un recibo
real con el clip 📎. El flujo completo (leer el recibo -> preguntas -> plan) usa
las dos llamadas.
