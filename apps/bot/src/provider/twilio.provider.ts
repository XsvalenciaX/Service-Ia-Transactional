import { createProvider } from "@builderbot/bot";
import { TwilioProvider } from "@builderbot/provider-twilio";

export const provider = createProvider(TwilioProvider, {
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  vendorNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? "",
  publicUrl: process.env.PUBLIC_URL,
});
