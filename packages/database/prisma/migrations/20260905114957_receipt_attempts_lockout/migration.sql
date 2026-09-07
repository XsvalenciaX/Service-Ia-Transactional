-- AlterEnum
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_MANUAL_CONSUMPTION';
ALTER TYPE "ConversationStep" ADD VALUE 'LOCKED';

-- AlterTable
-- "receiptAttempts" va con IF NOT EXISTS porque las dos ramas que se
-- fusionaron acá crearon la misma columna por su cuenta: la otra en
-- 20260904135603_add_receipt_attempts, que corre antes. Sin esto, la
-- migración explota con "column already exists" en cualquier base que venga
-- de esa rama.
ALTER TABLE "conversation_states" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "receiptAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receipts" ALTER COLUMN "imagePath" DROP NOT NULL;
