# Integración con IA (pendiente)

El proveedor y el modelo de IA todavía **no están definidos**. Mientras tanto,
los dos puntos donde se va a conectar están mockeados pero con la forma de
request/response ya pensada para no tener que tocar el resto del flujo
cuando se elija el proveedor.

Variable de entorno ya reservada para la API key, cualquiera sea el
proveedor: `AI_PROVIDER_API_KEY` (ver `.env.example`).

## 1. Validar y extraer datos del recibo

**Archivo:** `src/receipt/receipt.service.ts`
**Función a reemplazar:** `analyzeReceiptWithModel(request)`

- **Recibe** (`ReceiptAnalysisRequest`): la imagen del recibo en base64 +
  las instrucciones/prompt para el modelo (ya armadas en
  `buildReceiptAnalysisRequest`, no hace falta tocarlas).
- **Tiene que devolver** (`ReceiptAnalysisResult`):
  - `valid: boolean` — si la imagen es un recibo de luz legible.
  - `recommendation?: string` — si `valid` es `false`, por qué no se pudo
    leer y qué debería hacer el usuario (foto borrosa, mala luz, no es un
    recibo, etc). El flow se lo muestra tal cual al usuario.
  - Si `valid` es `true`: `consumptionKwh`, `amount`, `currency`,
    `periodStart`, `periodEnd` (fechas en formato `YYYY-MM-DD`).
- **Qué hacer:** reemplazar el cuerpo de la función por la llamada real al
  proveedor elegido, mandándole `request.image` y `request.instructions`, y
  mapear su respuesta a `ReceiptAnalysisResult`. No hace falta tocar
  `processReceipt` ni el flow (`apps/bot/src/flows/receipt.flow.ts`) — ya
  reaccionan a `valid`/`recommendation` correctamente.

## 2. Generar el plan de ahorro

**Archivo:** `src/plan/plan.service.ts`
**Función a reemplazar:** `generatePlanContent(request)`

- **Recibe** (`PlanGenerationRequest`): `context` (texto con el consumo del
  recibo + las preguntas y respuestas de electrodomésticos, ya armado en
  `buildPlanGenerationRequest`), `instructions` (qué se le pide al modelo),
  y opcionalmente `image` (la foto original del recibo, en base64, si
  todavía existe en disco).
- **Tiene que devolver** (`SavingsPlanContent`): `targetReductionPercent`,
  `summary`, `recommendations: string[]`.
- **Qué hacer:** reemplazar el cuerpo de la función por la llamada real,
  mandándole `context` + `instructions` (+ `image` si el proveedor elegido
  soporta visión y se quiere aprovechar). No hace falta tocar
  `generateSavingsPlan` ni `plan.flow.ts`.

## Qué NO hace falta tocar

- La construcción de los requests (`buildReceiptAnalysisRequest`,
  `buildPlanGenerationRequest`) ya arma el contenido correcto; si el
  proveedor elegido necesita un formato de mensaje distinto (bloques de
  imagen/texto, roles, etc.), armarlo a partir de estos campos dentro de la
  función que llama al modelo, sin cambiar las interfaces que ya consume el
  resto del código.
- La validación de que las respuestas del usuario sean texto
  (`apps/bot/src/utils/message-validation.ts`) no tiene relación con esto,
  ya está implementada y funcionando.
