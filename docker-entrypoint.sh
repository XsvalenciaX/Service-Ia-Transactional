#!/bin/sh
set -e

# Los volúmenes montados (bot_sessions, uploads) los crea Docker como root,
# aunque la imagen corra el proceso como el usuario "node". Sin este chown,
# Baileys no puede persistir el estado de la sesión y el QR nunca aparece.
mkdir -p /app/apps/bot/energy-bot_sessions /app/apps/bot/uploads
chown -R node:node /app/apps/bot/energy-bot_sessions /app/apps/bot/uploads

exec setpriv --reuid=node --regid=node --init-groups "$@"
