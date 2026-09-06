-- AlterEnum
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_MANUAL_CONSUMPTION';
ALTER TYPE "ConversationStep" ADD VALUE 'LOCKED';

-- AlterTable
ALTER TABLE "conversation_states" ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "receiptAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receipts" ALTER COLUMN "imagePath" DROP NOT NULL;
