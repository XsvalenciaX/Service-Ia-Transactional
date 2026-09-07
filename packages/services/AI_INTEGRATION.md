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
todavía — tiene que estar impreso en la factura, nunca calculado a partir del consumo
del período.

**Dónde está el promedio, en concreto.** Casi nunca viene como texto: está en la
*última barra del gráfico del historial*, separada del resto y rotulada **PROM**
(al pie, "PROMEDIO DE LOS ÚLTIMOS 6 MESES = PROM"). El prompt lo describe así de
literal, y le aclara dos cosas que el modelo confundía:

- La barra **PROM** no es la barra **Actual**: esa segunda es el consumo del período.
- Una factura de EPM trae **un gráfico por servicio** — acueducto, alcantarillado y
  gas en m³, energía en kWh. El prompt obliga a usar el gráfico cuyo título dice
  **kWh** y a ignorar los de m³.

**No se extrae ningún monto.** El prompt se lo prohíbe explícitamente y el JSON ni
siquiera tiene el campo. El bot no habla de dinero en ninguna parte del flujo, así
que el valor de la factura no se lee, no se guarda y no se le muestra al usuario.

Antes sí se extraía, y traía dos problemas encadenados: en Colombia las facturas
vienen agrupadas (acueducto, alcantarillado, gas, aseo, cuentas vencidas), así que
el bot le decía a un usuario de EPM *"leí un consumo de 98 kWh por 581.149 COP"*
cuando la energía eran 72.285 — y aun leyendo bien el renglón, seguía siendo un
precio en pantalla. La migración `drop_receipt_amount` sacó `amount` y `currency`
de las filas que ya estaban guardadas.

**Si la foto no se puede leer —o se lee pero sin el promedio—**, `receipt.flow.ts`
suma un intento en `ConversationState.receiptAttempts` y deja al usuario en
`AWAITING_RECEIPT` para que mande otra. El tope son `MAX_RECEIPT_ATTEMPTS` (3).

**Cuando sí se lee**, el mensaje de confirmación muestra los *dos* números y dice
cuál manda: "leí un consumo de 106 kWh en el período facturado y un consumo promedio
de 112 kWh en los últimos meses. Tu plan lo armo sobre el promedio". Enseñar sólo el
consumo del período —como quedó tras el merge— hacía parecer que el modelo había
leído la barra equivocada del gráfico (la "Actual" en vez de la "PROM"), aunque el
promedio estuviera bien extraído y guardado.

Que **la falta del promedio cuente como intento fallido** no es un detalle: es el
dato del que sale la meta (`calculateTargetKwh`). Sin esa validación el bot seguía de
largo con un recibo a medias, hacía todas las preguntas y recién al final entregaba
un plan sin objetivo en kWh. Y el mensaje de reintento nombra el problema real —le
pide la foto del recuadro del histórico, no "una foto más clara"— porque el promedio
se pierde por encuadre, no por nitidez: repetir el mismo encuadre no lo arregla.

**Agotados los 3 intentos** el bot deja de pedir fotos —cada una cuesta una llamada
al modelo— y pasa a `ASKING_MANUAL_CONSUMPTION`, donde le pide el número escrito:
"escribime el consumo promedio en kWh". Lo atiende `manual-consumption.flow.ts`, que
es deliberadamente estricto: **un solo intento**, sin `fallBack`. Si no pasa la
validación, `lockUntilTomorrow()` lo manda a `LOCKED` y el bot no le contesta nada
hasta la medianoche siguiente.

Se valida en dos pasos, y el segundo importa: además del formato numérico,
`isPlausibleConsumption()` exige que el número caiga entre `MIN_CONSUMPTION_KWH` y
`MAX_CONSUMPTION_KWH` (10–20.000). El error más común acá es escribir **el total a
pagar** en vez de los kWh — un "581149" pasa cualquier validación de formato — y
guardarlo dejaba el plan armado sobre un promedio absurdo, con una meta de 523.034
kWh. El mensaje de rechazo dice explícitamente que sea el consumo en kWh y no el
total a pagar.

El desbloqueo no necesita que nadie lo dispare: `getOrCreateSession()` compara
`lockedUntil` contra el reloj en cada mensaje y, si ya pasó, resetea a
`AWAITING_RECEIPT` y devuelve `justUnlocked` para que el flow lo salude. El mismo
mecanismo maneja `planReadyAt` y el mínimo de `MIN_DAYS_BETWEEN_PLANS` (15) entre un
plan y el siguiente.

El número que escribe el usuario se guarda con `saveManualConsumption()` como
**`averageConsumptionKwh`** —que es lo que el bot le pidió— con `source: "manual"`.
Ese es el dato con el que `calculateTargetKwh()` arma la meta: guardarlo como consumo
del período dejaba a estos usuarios sin objetivo en kWh.

**Tono:** los dos system prompts están escritos en español neutro y piden respuestas
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

## 3. Preguntas fuera de guion: ya no las contesta la IA

Hubo un tercer servicio (`assistant.service.ts`) que respondía con IA cualquier
mensaje que no fuera lo que el bot esperaba. **Se eliminó** en `094e5dc` ("remove AI
free-text fallback"): el bot es 100% guiado y a lo que no entiende responde con un
mensaje fijo desde `welcome.flow.ts`.

Qué implica, para no volver a proponerlo sin querer:

- **La IA sólo corre en dos puntos**: leer el recibo y generar el plan. Nada más
  gasta tokens, y el costo por conversación no depende de cuánto escriba la persona.
- Se fue con él la superficie donde el bot podía hablar de precios por su cuenta.
- Los comandos (ver el plan, borrar el progreso) van a vivir en una plantilla aparte,
  no en texto libre.

## Cuando la IA no está disponible

Todo lo que puede fallar (falta de API key, key inválida, rate limit, imagen
demasiado pesada, respuesta no parseable) sale como `AiError` desde
`src/shared/ai.ts`, para poder distinguirlo de un bug. Los tres servicios lo
capturan y degradan en vez de cortar la conversación:

- **Recibo:** devuelve `valid: false` con una explicación. El flow ya sabe pedir
  la foto de nuevo y el usuario se queda en `AWAITING_RECEIPT`, gastando un intento.
- **Plan:** guarda un plan genérico con estado **`PENDIENTE`** (en vez de
  `GENERADO`), que es la marca de que hay que regenerarlo. El flow avisa que no se
  pudo personalizar, sin sugerir `reiniciar`: ese comando sólo funciona fuera de
  producción (ver `restart.flow.ts`).

En los dos casos el motivo real queda en la consola del servidor
(`[receipt] falló...` / `[plan] falló...`).

## Cómo probarlo

Con `AI_PROVIDER_API_KEY_OPENAI` cargada, `pnpm sim` y adjuntá una foto de un recibo
real con el clip 📎. El flujo completo (leer el recibo -> preguntas -> plan) usa las
dos llamadas.

Para recorrer los flujos **sin gastar tokens**, `AI_MOCK=true` en el `.env`: ningún
servicio llama a la API real y cada pedido devuelve el `mock` que define en su
`requestJson()`. Si un pedido nuevo no define `mock`, revienta con `AiError` a
propósito, para que no pase inadvertido que esa ruta sí estaba llamando al modelo.
