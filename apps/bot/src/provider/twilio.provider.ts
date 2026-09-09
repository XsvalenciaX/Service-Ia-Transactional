import { createProvider } from "@builderbot/bot";
import { TwilioProvider } from "@builderbot/provider-twilio";
import { toWhatsappAddress } from "./twilio-address.js";

export const provider = createProvider(TwilioProvider, {
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  vendorNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? "",
  publicUrl: process.env.PUBLIC_URL,
});

patchOutgoingWhatsappAddresses(provider);

// @builderbot/provider-twilio siempre fuerza "+" en to/from; no expone un
// hook para arreglarlo, así que interceptamos messages.create justo antes
// de la llamada real. provider.vendor se asigna async, por eso el setter.
function patchOutgoingWhatsappAddresses(providerInstance: typeof provider) {
  let vendor: (typeof providerInstance)["vendor"];

  Object.defineProperty(providerInstance, "vendor", {
    configurable: true,
    enumerable: true,
    get() {
      return vendor;
    },
    set(nextVendor) {
      vendor = nextVendor;
      patchMessagesCreate(vendor?.twilio);
    },
  });
}

function patchMessagesCreate(twilioClient: any) {
  const create = twilioClient?.messages?.create;
  if (!create || create.__patchedForWhatsappAddress) return;

  const originalCreate = create.bind(twilioClient.messages);
  const patchedCreate = (params: Record<string, unknown>) => {
    const patched = { ...params };
    if (typeof patched.to === "string") patched.to = toWhatsappAddress(patched.to);
    if (typeof patched.from === "string") patched.from = toWhatsappAddress(patched.from);
    return originalCreate(patched);
  };
  patchedCreate.__patchedForWhatsappAddress = true;
  twilioClient.messages.create = patchedCreate;
}
