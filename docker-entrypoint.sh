#!/bin/sh
set -e

# El volumen montado (uploads) lo crea Docker como root, aunque la imagen
# corra el proceso como el usuario "node". Sin este chown, el provider no
# puede guardar los archivos recibidos (recibos, etc).
mkdir -p /app/apps/bot/uploads
chown -R node:node /app/apps/bot/uploads

exec setpriv --reuid=node --regid=node --init-groups "$@"
