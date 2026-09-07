#!/bin/bash
set -e

cd "$(dirname "$0")/.."

LOG_FILE="/tmp/energy-bot-dev.log"

cleanup() {
  echo ""
  echo "Deteniendo servidor y ngrok..."
  kill "$DEV_PID" "$NGROK_PID" 2>/dev/null
  wait "$DEV_PID" "$NGROK_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo "Levantando servidor (pnpm dev)..."
pnpm dev > "$LOG_FILE" 2>&1 &
DEV_PID=$!

echo "Esperando a que el puerto 3000 responda..."
until curl -s -o /dev/null http://localhost:3000/tmp; do
  sleep 1
done
echo "Servidor arriba (PID $DEV_PID)."

echo "Levantando ngrok..."
ngrok http 3000 --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

echo "Esperando URL publica de ngrok..."
sleep 3
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o '"public_url":"[^"]*"' | head -1 | cut -d'"' -f4)

echo ""
echo "Servidor local: http://localhost:3000"
echo "URL publica:    $NGROK_URL"
echo "Webhook Twilio: $NGROK_URL/webhook"
echo ""
echo "Ctrl+C para detener ambos procesos."

wait "$DEV_PID" "$NGROK_PID"
