import { defineConfig, env } from "prisma/config";
import { loadRootEnv } from "./src/load-env.js";

// The .env file lives at the monorepo root; pnpm --filter runs this
// script with this package's directory as the cwd.
loadRootEnv(import.meta.dirname);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
