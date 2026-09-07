#!/bin/bash
set -e

cd "$(dirname "$0")/../packages/database"

echo "Reseteando base de datos (energy_bot)..."
pnpm exec prisma migrate reset --force

echo "Base de datos reseteada y migraciones aplicadas."
