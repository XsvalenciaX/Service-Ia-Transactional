import { prisma } from "../client.js";
import type { User } from "../../generated/prisma/client.js";

export async function findOrCreateByPhone(
  phone: string,
  name?: string
): Promise<User> {
  return prisma.user.upsert({
    where: { phone },
    update: name ? { name } : {},
    create: { phone, name },
  });
}

export async function findByPhone(phone: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { phone } });
}
