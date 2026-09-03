import fs from "node:fs/promises";

export function guessImageMediaType(filePath: string): string {
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
