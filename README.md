# energy-bot

Bot conversacional de WhatsApp que ayuda a un usuario a armar un plan de ahorro
energético del 15%. Monorepo con **pnpm workspaces**, separado en capas:

- `apps/bot` — presentación: flujos de **BuilderBot** + provider **Baileys** (QR). No
  contiene lógica de negocio ni accede a la base de datos directamente.
- `packages/services` — lógica de negocio pura (recibo, electrodomésticos, plan,
  estado de la conversación). No conoce BuilderBot ni WhatsApp.
- `packages/database` — schema de **Prisma** (Postgres), cliente y repositorios.

La IA (Anthropic / Claude) se usa en dos puntos, los dos dentro de
`packages/services` — ver [AI_INTEGRATION.md](packages/services/AI_INTEGRATION.md):

- `src/receipt/receipt.service.ts` — lee la foto del recibo y extrae el consumo.
- `src/plan/plan.service.ts` — arma el plan de ahorro con esos datos más las
  respuestas del usuario sobre sus electrodomésticos.
- `src/assistant/assistant.service.ts` — responde las preguntas que el usuario hace
  fuera del guion: si son sobre su plan o sobre energía, las contesta con sus propios
  datos; si no tienen que ver, avisa que de eso no puede ayudar y reconduce.

El modelo por defecto es `gpt-5.6-luna` (el más barato con visión); se cambia
con `AI_MODEL` en el `.env`. Si la IA no está disponible, los dos servicios
degradan en vez de cortar la conversación.

## Requisitos

- Node.js 20+
- Una API key de OpenAI en `AI_PROVIDER_API_KEY_OPENAI` (ver
  [Configurar la IA](#configurar-la-ia) más abajo)
- pnpm (`npm i -g pnpm`; `corepack enable` sólo sirve hasta Node 24)
- PostgreSQL corriendo localmente (o accesible por red) — o, más simple, Docker
  (ver [Correr con Docker](#correr-con-docker) más abajo)

## Levantar el proyecto

1. Instalar dependencias del workspace:

   ```bash
   pnpm install
   ```

2. Crear el archivo de entorno en la raíz del proyecto:

   ```bash
   cp .env.example .env
   ```

   Edita `DATABASE_URL` con los datos de tu Postgres local. `AI_PROVIDER_API_KEY`
   se deja vacío por ahora (se usará cuando se conecte la IA).

3. Generar el cliente de Prisma y correr las migraciones:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

4. Levantar el bot en modo desarrollo:

   ```bash
   pnpm dev
   ```

   Va a aparecer un **QR en la consola**: escanéalo desde WhatsApp (Dispositivos
   vinculados → Vincular un dispositivo). Si por lo que sea no se ve bien en la
   terminal, Baileys también deja una imagen `apps/bot/<BOT_SESSION_NAME>.qr.png`
   que puedes abrir directamente. La sesión queda guardada en
   `apps/bot/<BOT_SESSION_NAME>_sessions/` para no tener que volver a escanear en
   cada reinicio.

5. (Opcional) Ver los datos guardados con Prisma Studio:

   ```bash
   pnpm db:studio
   ```

## Correr con Docker

Si no quieres instalar Postgres localmente, `docker-compose.yml` levanta la base de
datos **y** el bot (con su propio `Dockerfile`, que compila los tres paquetes del
monorepo y corre las migraciones al arrancar):

```bash
pnpm docker:up
```

Esto expone Postgres en `localhost:5432` y corre el bot dentro de un contenedor. El
**QR sale por los logs** del contenedor `bot` (`docker compose logs -f bot` si lo
corriste en segundo plano). La sesión de Baileys y las imágenes de recibos quedan en
volúmenes con nombre (`bot_sessions`, `bot_uploads`), así que no hay que volver a
escanear el QR en cada `docker compose up`.

Para bajar todo: `pnpm docker:down` (agrega `-v` manualmente con `docker compose down
-v` si además quieres borrar los volúmenes, es decir la sesión de WhatsApp y los datos
de Postgres).

Si prefieres usar Docker **solo para Postgres** y seguir corriendo el bot con `pnpm
dev` en tu máquina, comenta o borra el servicio `bot` de `docker-compose.yml` y deja
`DATABASE_URL` en tu `.env` apuntando a `localhost:5432` (como ya viene en
`.env.example`).

## Configurar la IA

El bot usa **GPT (OpenAI)** para dos cosas: leer la foto del recibo y armar
el plan de ahorro. Hace falta una API key:

1. Entrá a <https://platform.openai.com> y creá una cuenta (o iniciá sesión).
2. Cargá saldo en **Billing** — la API se paga por uso y no trae crédito gratis.
   Con el mínimo (USD 5) alcanza para miles de recibos: con `gpt-5.6-luna`,
   leer un recibo y generar un plan cuesta del orden de **USD 0,001** en total.
3. Andá a **API keys**, tocá *Create new secret key*, copiala (se muestra una
   sola vez; empieza con `sk-`).
4. Pegala en el `.env` de la raíz:

   ```bash
   AI_PROVIDER_API_KEY_OPENAI=sk-...
   AI_MODEL=gpt-5.6-luna
   AI_REASONING_EFFORT=none
   ```

5. Reiniciá el bot o el simulador (la key se lee al arrancar).

### Elegir el modelo

`AI_MODEL` decide qué modelo se usa; todos leen imágenes. Precios por millón de
tokens (entrada / salida):

| Modelo             | Precio          | Cuándo usarlo                                      |
| ------------------ | --------------- | -------------------------------------------------- |
| `gpt-5.6-luna`     | USD 0,20 / 1,20 | Por defecto. El más barato, alcanza para probar     |
| `gpt-5.6-luna-pro` | USD 1,25 / 10   | Si falla leyendo recibos borrosos o mal iluminados  |

Cambiar de modelo es sólo editar el `.env` y reiniciar: no hay que tocar código.

Luna es un modelo de razonamiento y **los tokens que piensa se facturan como
salida**, que es la parte cara. Por eso `AI_REASONING_EFFORT` viene en `none`:
leer un recibo y redactar un plan son tareas de un solo paso. Subirlo a `low` o
`medium` puede duplicar o triplicar el costo de cada llamada, así que sólo tiene
sentido si la extracción falla con recibos reales.

### La key no se sube al repo

`.env` está en `.gitignore`. Lo que se versiona es `.env.example`, que tiene la
variable vacía. Si la key se filtra, revocala desde la misma pantalla de
**API keys** de la consola.

## Probar sin WhatsApp (simulador)

Vincular el bot a un número real es incómodo para desarrollar: la sesión de Baileys
queda atada a un solo WhatsApp y hace falta un segundo teléfono que le escriba. Para
iterar sobre los flujos hay un simulador con una interfaz de chat en el navegador, que
corre los mismos flows de BuilderBot contra un provider mock (`TestTool.TestProvider`),
sin WhatsApp de por medio:

```bash
pnpm sim
```

Abrí la URL que imprime (por defecto `http://localhost:3100`; si el puerto está ocupado
prueba el siguiente, o fijalo con `SIM_PORT`). Escribís abajo, el bot responde arriba,
los botones Sí/No son clickeables y podés adjuntar o arrastrar una foto real del recibo
con el clip 📎.

- Cada vez que abrís o recargás la página (y con el botón **Nuevo chat**) estrenás
  número, o sea otro `User` con su `ConversationState` en WELCOME. Es a propósito: si
  reusara el mismo número, al segundo intento ya estaría en COMPLETED y `welcomeFlow`
  cortaría con `endFlow()` sin responder nada, que parece un bot colgado.
- El header muestra el paso actual de la conversación (WELCOME, AWAITING_RECEIPT, …),
  que es el que decide qué flow atiende cada mensaje.
- Escribir **reiniciar** (o `reset`, o `empezar de nuevo`) en cualquier momento vuelve a
  empezar sin cambiar de número. Funciona igual por WhatsApp.
- Usa la misma base de datos que `pnpm dev`, así que lo que guardes es real y lo podés
  revisar con `pnpm db:studio`.
- No levanta el servidor HTTP del bot, así que puede correr en paralelo con `pnpm dev`
  sin pelear por el puerto 3000.

## Flujo conversacional


1. **Bienvenida**: cualquier mensaje del usuario dispara la presentación del bot y
   la solicitud de la foto del recibo de energía.
2. **Recibo**: al recibir una imagen, el bot la guarda en `apps/bot/uploads/` y se
   la manda a la IA, que valida si es una factura de energía y extrae el consumo del
   período y el **consumo promedio** de los últimos meses.
   - Si no es una factura (una foto cualquiera, un menú, un documento) o no se puede
     leer el promedio, responde *"No logramos identificar el consumo, por favor digita
     el valor en kWh"*, explica qué pasó y ofrece las dos salidas: otra foto de la
     factura completa, o el número escrito a mano.
   - A partir del **tercer intento** deja de pedir fotos y pide directamente el número.
   - El usuario puede escribir el consumo en cualquier momento (`265`, `265 kwh`,
     `1.250`): se guarda como `Receipt` con `source: "manual"` y el flujo sigue. Se
     rechazan valores fuera del rango razonable (10–20.000 kWh) para no armar el plan
     con un número que en realidad era el total a pagar.
   - Los intentos se cuentan en `ConversationState.receiptAttempts` y se reinician con
     `reiniciar`.
3. **Electrodomésticos**: el bot pregunta, uno por uno, por aire acondicionado,
   plancha y horno/air fryer. Cada uno arranca con una pregunta Sí/No (con
   botones). Si la respuesta es "No", se salta directo al siguiente
   electrodoméstico sin guardar nada; si es afirmativa, pregunta la
   frecuencia/horas de uso y ahí sí guarda un `Appliance` asociado al usuario.
4. **Cierre**: con recibo + electrodomésticos guardados, la IA genera el
   `SavingsPlan` a partir del consumo del recibo y de las respuestas del usuario,
   y el bot se lo manda por chat (resumen + recomendaciones numeradas).
5. **Una vez al mes**: el proceso completo (recibo → preguntas → plan) se hace una
   vez por mes calendario, que es el ritmo al que llega la factura. Si el usuario
   manda otra foto o escribe `reiniciar` con el plan del mes ya hecho, el bot le
   responde que ya lo tiene y le dice en qué mes vuelve. Cuando el plan es de un
   mes anterior, la foto nueva arranca sola el siguiente ciclo. Un plan en estado
   `PENDIENTE` (el genérico de cuando la IA no respondió) no cuenta como hecho.
6. **Preguntas fuera de guion**: si el usuario escribe cualquier otra cosa (una
   duda sobre su plan, sobre su factura, o algo que no tiene nada que ver), la
   atiende la IA vía `welcomeFlow`, que es el catch-all de BuilderBot. Contesta
   con los datos del propio usuario si la pregunta es de energía; si no lo es,
   avisa que de eso no puede ayudar y reconduce la conversación. También funciona en
   medio de las preguntas de electrodomésticos: ahí el bot responde la duda y vuelve
   a hacer la pregunta del paso, sin perder el lugar ni guardar la pregunta como si
   fuera la respuesta.
7. **Reinicio**: en cualquier punto, el mensaje `reiniciar` (o `reset` /
   `empezar de nuevo`) borra el recibo, los electrodomésticos y el plan del
   usuario, lo devuelve a `WELCOME` y vuelve a saludar. Como los pasos con
   `capture` se llevan el mensaje antes de que BuilderBot evalúe las keywords,
   `appliances.flow.ts` chequea el comando explícitamente.

## Scripts (desde la raíz)

| Script             | Descripción                                             |
| ------------------ | -------------------------------------------------------- |
| `pnpm install`      | Instala todo el workspace                                |
| `pnpm dev`          | Levanta el bot en modo desarrollo (muestra el QR)         |
| `pnpm sim`          | Simulador web: prueba los flujos en el navegador          |
| `pnpm build`        | Compila `database`, `services` y `bot` en orden          |
| `pnpm db:generate`  | Genera el cliente de Prisma                              |
| `pnpm db:migrate`   | Corre las migraciones de Prisma                          |
| `pnpm db:studio`    | Abre Prisma Studio                                       |
| `pnpm docker:up`    | Levanta Postgres + bot con Docker Compose                |
| `pnpm docker:down`  | Baja los contenedores de Docker Compose                  |

