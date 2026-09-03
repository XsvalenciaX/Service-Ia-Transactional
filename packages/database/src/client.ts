import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { loadRootEnv } from "./load-env.js";

// Allows this package to be used both from `pnpm --filter` scripts (cwd =
// packages/database) and from apps/bot (cwd = apps/bot) without each
// consumer having to load env vars itself.
loadRootEnv(import.meta.dirname);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export * from "../generated/prisma/client.js";
