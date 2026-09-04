import { prisma } from "../client.js";
import { ApplianceType } from "../../generated/prisma/client.js";
import type { Appliance } from "../../generated/prisma/client.js";

export async function create(data: {
  userId: string;
  type: ApplianceType;
  frequencyPerWeek?: number;
  usageNote?: string;
}): Promise<Appliance> {
  return prisma.appliance.create({
    data: {
      userId: data.userId,
      type: data.type,
      frequencyPerWeek: data.frequencyPerWeek,
      usageNote: data.usageNote,
    },
  });
}

export async function findAllByUserId(userId: string): Promise<Appliance[]> {
  return prisma.appliance.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteAllByUserId(userId: string): Promise<number> {
  const { count } = await prisma.appliance.deleteMany({ where: { userId } });
  return count;
}

export { ApplianceType };
