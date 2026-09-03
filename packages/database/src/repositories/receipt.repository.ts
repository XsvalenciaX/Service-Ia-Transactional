import { prisma } from "../client.js";
import type { Prisma, Receipt } from "../../generated/prisma/client.js";

export async function create(data: {
  userId: string;
  imagePath: string;
  extractedData?: Record<string, unknown>;
}): Promise<Receipt> {
  return prisma.receipt.create({
    data: {
      userId: data.userId,
      imagePath: data.imagePath,
      extractedData: data.extractedData as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function findLatestByUserId(
  userId: string
): Promise<Receipt | null> {
  return prisma.receipt.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
