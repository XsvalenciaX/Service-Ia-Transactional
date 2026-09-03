# energy-bot

Bot conversacional de WhatsApp que ayuda a un usuario a armar un plan de ahorro
energético del 15%. Monorepo con **pnpm workspaces**, separado en capas:

- `apps/bot` — presentación: flujos de **BuilderBot** + provider **Baileys** (QR). No
  contiene lógica de negocio ni accede a la base de datos directamente.
- `packages/services` — lógica de negocio pura (recibo, electrodomésticos, plan,
  estado de la conversación). No conoce BuilderBot ni WhatsApp.
- `packages/database` — schema de **Prisma** (Postgres), cliente y repositorios.

Los dos puntos donde luego se conectará IA (extracción del recibo y generación del
plan de ahorro) están marcados con `// TODO: lógica de IA - ...` en:

- `packages/services/src/receipt/receipt.service.ts`
- `packages/services/src/plan/plan.service.ts`

Mientras tanto, esos servicios devuelven datos mock para que el flujo conversacional
completo (bienvenida → recibo → preguntas de electrodomésticos → cierre) funcione de
punta a punta.

## Requisitos

- Node.js 20+
- pnpm (`corepack enable` o `npm i -g pnpm`)
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

## Flujo conversacional

1. **Bienvenida**: cualquier mensaje del usuario dispara la presentación del bot y
   la solicitud de la foto del recibo de energía.
2. **Recibo**: al recibir una imagen, el bot la guarda en `apps/bot/uploads/` y
   crea el registro `Receipt` (con datos mock hasta conectar la IA de extracción).
3. **Electrodomésticos**: el bot pregunta, uno por uno, por aire acondicionado,
   plancha y horno/air fryer. Cada uno arranca con una pregunta Sí/No (con
   botones). Si la respuesta es "No", se salta directo al siguiente
   electrodoméstico sin guardar nada; si es afirmativa, pregunta la
   frecuencia/horas de uso y ahí sí guarda un `Appliance` asociado al usuario.
4. **Cierre**: con recibo + electrodomésticos guardados, el bot genera un
   `SavingsPlan` (mock hasta conectar la IA de generación) y responde con un
   mensaje de confirmación.

## Scripts (desde la raíz)

| Script             | Descripción                                             |
| ------------------ | -------------------------------------------------------- |
| `pnpm install`      | Instala todo el workspace                                |
| `pnpm dev`          | Levanta el bot en modo desarrollo (muestra el QR)         |
| `pnpm build`        | Compila `database`, `services` y `bot` en orden          |
| `pnpm db:generate`  | Genera el cliente de Prisma                              |
| `pnpm db:migrate`   | Corre las migraciones de Prisma                          |
| `pnpm db:studio`    | Abre Prisma Studio                                       |
| `pnpm docker:up`    | Levanta Postgres + bot con Docker Compose                |
| `pnpm docker:down`  | Baja los contenedores de Docker Compose                  |

