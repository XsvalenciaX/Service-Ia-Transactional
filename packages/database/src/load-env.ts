import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Ruta al .env resuelta subiendo directorios hasta encontrar
// pnpm-workspace.yaml (la raíz del monorepo), en vez de una cuenta fija de
// "../..". Una relativa fija se rompe apenas cambia la profundidad del
// archivo que la usa (p.ej. tsc compilando packages/database con rootDir "."
// termina en dist/src/*.js, un nivel más profundo que src/*.ts).
function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No se encontró pnpm-workspace.yaml subiendo desde ${startDir}`
      );
    }
    dir = parent;
  }
}

export function loadRootEnv(fromDir: string): void {
  const root = findMonorepoRoot(fromDir);
  dotenv.config({ path: path.join(root, ".env") });
}
