// Ids opacos de WhatsApp (privacidad de número, ej. "CO.xxxx") no llevan "+".
// Idempotente: también repara una dirección ya mal prefijada con "+".
export function toWhatsappAddress(raw: string): string {
  const withoutPrefix = raw.replace(/^whatsapp:/, "").trim();
  const withoutPlus = withoutPrefix.replace(/^\+/, "");

  if (/^\d+$/.test(withoutPlus)) {
    return `whatsapp:+${withoutPlus}`;
  }

  return `whatsapp:${withoutPlus}`;
}
