-- CreateEnum
CREATE TYPE "ApplianceType" AS ENUM ('AIRE', 'PLANCHA', 'HORNO_AIRFRYER');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PENDIENTE', 'GENERADO');

-- CreateEnum
CREATE TYPE "ConversationStep" AS ENUM ('WELCOME', 'AWAITING_RECEIPT', 'ASKING_AIRE', 'ASKING_PLANCHA', 'ASKING_HORNO', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "extractedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appliances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ApplianceType" NOT NULL,
    "frequencyPerWeek" INTEGER,
    "usageNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appliances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" JSONB,
    "status" "PlanStatus" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStep" "ConversationStep" NOT NULL DEFAULT 'WELCOME',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_states_userId_key" ON "conversation_states"("userId");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_plans" ADD CONSTRAINT "savings_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
