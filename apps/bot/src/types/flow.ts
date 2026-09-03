import type { BotContext, BotMethods } from "@builderbot/bot/dist/types.js";

export type FlowContext = BotContext;
// P/B (provider/database) generics aren't threaded through our flows, so we
// keep them loose here; flowDynamic/gotoFlow/endFlow/state stay fully typed.
export type FlowMethods = BotMethods<any, any>;
