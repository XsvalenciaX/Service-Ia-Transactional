-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplianceType" ADD VALUE 'LAVADORA';
ALTER TYPE "ApplianceType" ADD VALUE 'SECADORA_GAS';
ALTER TYPE "ApplianceType" ADD VALUE 'TV';
ALTER TYPE "ApplianceType" ADD VALUE 'VENTILADOR';
ALTER TYPE "ApplianceType" ADD VALUE 'SECADOR_PELO';
ALTER TYPE "ApplianceType" ADD VALUE 'PLANCHA_PELO';
ALTER TYPE "ApplianceType" ADD VALUE 'ARROCERA';
ALTER TYPE "ApplianceType" ADD VALUE 'CALENTADOR_AGUA';
ALTER TYPE "ApplianceType" ADD VALUE 'LICUADORA';
ALTER TYPE "ApplianceType" ADD VALUE 'ESTUFA_ELECTRICA';
ALTER TYPE "ApplianceType" ADD VALUE 'CALEFACTOR';
ALTER TYPE "ApplianceType" ADD VALUE 'LAVAPLATOS';
ALTER TYPE "ApplianceType" ADD VALUE 'CONSOLA';
ALTER TYPE "ApplianceType" ADD VALUE 'SONIDO';
ALTER TYPE "ApplianceType" ADD VALUE 'MICROONDAS';
ALTER TYPE "ApplianceType" ADD VALUE 'ASPIRADORA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_LAVADORA';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_SECADORA_GAS';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_TV';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_VENTILADOR';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_SECADOR_PELO';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_PLANCHA_PELO';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_ARROCERA';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_CALENTADOR_AGUA';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_LICUADORA';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_ESTUFA_ELECTRICA';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_CALEFACTOR';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_LAVAPLATOS';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_CONSOLA';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_SONIDO';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_MICROONDAS';
ALTER TYPE "ConversationStep" ADD VALUE 'ASKING_ASPIRADORA';
