-- El cierre por intentos agotados pasó a resolverse con el paso LOCKED y
-- `lockedUntil` (ver 20260905114957_receipt_attempts_lockout), que además
-- caduca solo. `closedAt` quedó sin uso: se da de baja para que el esquema y
-- la base vuelvan a coincidir.
ALTER TABLE "conversation_states" DROP COLUMN IF EXISTS "closedAt";
