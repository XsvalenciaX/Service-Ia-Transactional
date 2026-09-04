import { prisma } from "../client.js";
import { PlanStatus } from "../../generated/prisma/client.js";
import type { Prisma, SavingsPlan } from "../../generated/prisma/client.js";

export async function upsertForUser(data: {
  userId: string;
  content: Record<string, unknown>;
  status: PlanStatus;
}): Promise<SavingsPlan> {
  const content = data.content as Prisma.InputJsonValue;
  const existing = await prisma.savingsPlan.findFirst({
    where: { userId: data.userId },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return prisma.savingsPlan.update({
      where: { id: existing.id },
      data: { content, status: data.status },
    });
  }

  return prisma.savingsPlan.create({
    data: {
      userId: data.userId,
      content,
      status: data.status,
    },
  });
}

export async function findLatestByUserId(
  userId: string
): Promise<SavingsPlan | null> {
  return prisma.savingsPlan.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteAllByUserId(userId: string): Promise<number> {
  const { count } = await prisma.savingsPlan.deleteMany({ where: { userId } });
  return count;
}

export { PlanStatus };
