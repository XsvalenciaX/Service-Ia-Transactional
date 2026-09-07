# Integración con IA

Proveedor: **OpenAI (GPT)**, vía el SDK oficial `openai`, endpoint
`chat.completions` con `response_format: json_object`.

- API key: `AI_PROVIDER_API_KEY_OPENAI` en el `.env` de la raíz. Se aceptan
  también `AI_PROVIDER_API_KEY` y `OPENAI_API_KEY`, en ese orden — el sufijo por
  proveedor existe para poder dejar conviviendo las keys de varios sin pisarlas.
  Se saca de <https://platform.openai.com/api-keys>.
- Modelo: `AI_MODEL`, por defecto **`gpt-5.6-luna`** — el más barato del
  catálogo que entiende imágenes (USD 0,20 por millón de tokens de entrada, 1,20
  de salida), que es lo que hace falta para leer la foto de un recibo. Para más
  precisión: `gpt-5.6-luna-pro`, sin tocar código.
- Razonamiento: `AI_REASONING_EFFORT`, por defecto **`none`**. Luna piensa antes
  de responder y esos tokens se facturan como salida; las dos tareas son de un
  solo paso, así que pensar sólo agrega costo. Si la lectura del recibo falla con
  fotos reales, `low` es el primer escalón.

El cliente vive en `src/shared/ai.ts` y se crea **la primera vez que se lo usa**,
no al importar el módulo: el bot importa estos servicios al arrancar y, si no,
no podría levantar ni mostrar el QR sin la API key configurada.

Las dos llamadas son de un solo turno, sin razonamiento ni tool use: son tareas
de un paso y así la prueba sale lo más barata posible.

## 1. Leer el recibo

**Archivo:** `src/receipt/receipt.service.ts` -> `analyzeReceiptWithModel()`

Manda la foto del recibo (bloque de imagen en base64) + `ANALYSIS_PROMPT`, con
`ANALYSIS_SYSTEM` como system prompt, y espera de vuelta el
`ReceiptAnalysisResult` en JSON: `valid`, `recommendation` (si no se pudo leer),
`consumptionKwh`, `averageConsumptionKwh`, `periodStart`, `periodEnd`.

El system prompt le prohíbe inventar valores: si un dato no se ve en la foto, lo
omite en vez de estimarlo. Para `averageConsumptionKwh` la regla es más estricta
todavía — tiene que estar impreso en la factura (el recuadro de "promedio últimos
6 meses" o el gráfico del historial), nunca calculado a partir del consumo del
período.

**No se extrae ningún monto.** El prompt se lo prohíbe explícitamente y el JSON ni
siquiera tiene el campo. El bot no habla de dinero en ninguna parte del flujo, así
que el valor de la factura no se lee, no se guarda y no se le muestra al usuario.

Antes sí se extraía, y traía dos problemas encadenados: en Colombia las facturas
vienen agrupadas (acueducto, alcantarillado, gas, aseo, cuentas vencidas), así que
el bot le decía a un usuario de EPM *"leí un consumo de 98 kWh por 581.149 COP"*
cuando la energía eran 72.285 — y aun leyendo bien el renglón, seguía siendo un
precio en pantalla. La migración `drop_receipt_amount` sacó `amount` y `currency`
de las filas que ya estaban guardadas.

**Si la foto no es una factura o falta el promedio**, `receipt.flow.ts` responde
"No logramos identificar el consumo, por favor digita el valor en kWh", suma un
intento en `ConversationState.receiptAttempts` y deja al usuario en
`AWAITING_RECEIPT`, ofreciendo las dos salidas: otra foto de la factura completa o
el número a mano.

**Al tercer intento se cierra el proceso del mes** (`MAX_INTENTOS_FOTO`): se marca
`ConversationState.closedAt` y a partir de ahí no se procesa ninguna foto más —el
guard está *antes* de guardar la imagen y de llamar al modelo, así que no se paga
esa llamada—, ni se acepta el número a mano, ni contesta el asistente. `reiniciar`
tampoco se lo salta. El cierre se compara contra el mes calendario, así que expira
solo: con la factura del mes siguiente el usuario vuelve a entrar.

El número escrito a mano lo atiende `welcome.flow.ts` (el catch-all): mientras el
paso sea `AWAITING_RECEIPT`, un mensaje que **es** un número se interpreta como el
consumo promedio. La puerta la abre `isStandaloneKwh()`, que exige que el mensaje no
sea más que la cifra y palabras de relleno ("son 265 kwh", "mi consumo promedio es
300"): sin eso, `extractKwh()` se quedaba con el primer número de cualquier frase y
"quién ganó el mundial 2022" terminaba guardado como 2022 kWh de consumo promedio.
Una frase con contenido propio se manda al asistente, que es lo que era.

Superado ese filtro lo parsea `extractKwh()` — entiende "265", "265 kwh", "1.250" —
e `isPlausibleConsumption()` descarta lo que no puede ser un consumo mensual (fuera
de 10–20.000 kWh), para no armar el plan sobre el total a pagar. Se guarda con
`registerManualAverageConsumption()`, que marca el registro con `source: "manual"`.

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

### La meta: 15% por dentro, 10% por fuera

Son dos números distintos y a propósito:

- **`PLAN_REDUCTION_PERCENT` (15%)** es lo que se le pide a la IA. El plan se diseña
  para 15% y `targetReductionPercent` vuelve con ese valor.
- **`PROMISED_REDUCTION_PERCENT` (10%)** es lo único que ve el usuario. La diferencia
  es el colchón: la meta se cumple aunque siga el plan a medias.

El kWh objetivo lo calcula **el código, no el modelo** (`calculateTargetKwh()`:
promedio × 0,9). Es el número contra el que el usuario va a comparar su próxima
factura, así que no puede depender de que la IA multiplique bien. `plan.flow.ts` lo
muestra como "Buscando que sea *239 kWh* o menos en la próxima factura", y lo omite
si nunca se supo el promedio.

**`PLAN_SYSTEM` le prohíbe al modelo escribir cualquier porcentaje o meta total** en
`summary` y `recommendations`. No es cosmético: mientras se lo permitimos, el plan
salía con tres cifras que no cerraban entre sí —

> ✅ Listo, este es tu plan para bajar un **10%** tu consumo:
> *"…para reducir **15%** frente al promedio, debes ahorrar aproximadamente
> **16,8 kWh**…"*
> 🎯 Buscando que sea **101 kWh** o menos en la próxima factura.

— el 15% del diseño interno, el ahorro calculado sobre ese 15% (112 − 16,8 = 95, no
101) y la meta real del 10%. Ahora la única voz que nombra la meta es el código: el
modelo diseña para 15% pero lo cuenta en **acciones y en kWh de cada
electrodoméstico**, nunca como porcentaje ni como total a ahorrar.

### Nada de dinero

El plan no habla de precios: ni pesos, ni tarifas, ni cuánto se ahorra en la factura.
El ahorro se expresa siempre en kWh o en porcentaje.

Está puesto en varias capas, no sólo en el prompt: el monto ya no se extrae del
recibo ni existe en la base, y `buildReceiptText()` igual filtra `amount` y
`currency` de lo que se le manda al modelo, como red de seguridad para cualquier
base que no haya corrido la migración. Si el dato no viaja, no hay forma de que se
le escape un precio en una recomendación.

`PLAN_SYSTEM` también le pide **priorizar los electrodomésticos de mayor potencia**
entre los que el usuario declaró (aire acondicionado > horno/air fryer > plancha):
ahí está el grueso del 15%, y sin la regla el modelo repartía parejo entre los tres.

## 3. Responder preguntas fuera de guion

**Archivo:** `src/assistant/assistant.service.ts` -> `answerQuestion()`

Lo llama `welcomeFlow` (el catch-all de BuilderBot) cuando el usuario escribe algo
que no era lo que el bot estaba esperando. Le manda el mensaje más el contexto del
propio usuario — su recibo, sus electrodomésticos, su plan y en qué paso está — y
recibe `{ onTopic, reply }`:

- **Del tema** (su plan, su factura, o energía en general: qué electrodoméstico gasta
  más, cómo se lee una factura, qué son los estratos, por qué le subió el consumo):
  responde con sus datos concretos. Ante la duda, el prompt le dice que asuma que la
  pregunta es del tema.
- **Fuera del tema** (deportes, chistes, recetas, otros servicios): no la responde ni
  en parte, avisa que de eso no puede ayudar y reconduce hacia lo que sí hace,
  proponiendo algo concreto de los datos del usuario.

Como el prompt recibe el paso actual, la respuesta cierra encarrilando: si todavía no
mandó el recibo, se lo vuelve a pedir.

### El asistente tampoco habla de dinero

Misma regla que el plan, pero acá hacía falta resolver un caso más: qué hacer cuando
la pregunta **es** sobre un precio ("¿cuánto vale el kWh?", "¿cuánta plata me ahorro?").

Marcarlas como fuera de tema sería raro — son preguntas de energía, y el usuario
recibiría un "de eso no puedo ayudarte" que suena a bot roto. Así que siguen siendo
`onTopic: true`, pero el prompt le prohíbe dar cualquier cifra en dinero: dice en una
frase que de precios no se encarga y reconduce a kWh. Sale así:

> *"De precios y tarifas no me encargo. Sí puedo ayudarte a revisar cuántos kWh
> consumes: en tu última factura fueron 287 kWh, y tu meta es bajar a 239 kWh o
> menos…"*

### La meta que ve el asistente es la prometida, no la real

El plan se guarda con `targetReductionPercent: 15`, que es lo que se le pidió a la IA.
Si el asistente lee ese 15% guardado, se lo repite al usuario — que sólo vio un 10% en
el mensaje del plan — y el bot se contradice.

Por eso `buildPlanForAssistant()` **reemplaza ese campo por
`PROMISED_REDUCTION_PERCENT`** antes de mandarle el plan, y el contexto agrega la meta
en kWh ya calculada ("bajar 10% su consumo, hasta 239 kWh o menos"), marcada como la
única cifra de meta que puede nombrar. El 15% no sale nunca de `plan.service.ts`.

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
