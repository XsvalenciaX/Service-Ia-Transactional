import fs from "node:fs/promises";

// Los tipos que acepta la API de IA para un bloque de imagen.
export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export function guessImageMediaType(filePath: string): ImageMediaType {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

export async function readImageAsBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}
