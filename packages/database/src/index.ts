export { prisma } from "./client.js";
export type {
  User,
  Receipt,
  Appliance,
  SavingsPlan,
  ConversationState,
  Prisma,
} from "../generated/prisma/client.js";

export * as userRepository from "./repositories/user.repository.js";
export * as receiptRepository from "./repositories/receipt.repository.js";
export * as applianceRepository from "./repositories/appliance.repository.js";
export * as planRepository from "./repositories/plan.repository.js";
export * as conversationStateRepository from "./repositories/conversation-state.repository.js";

export { ApplianceType } from "./repositories/appliance.repository.js";
export { PlanStatus } from "./repositories/plan.repository.js";
export { ConversationStep } from "./repositories/conversation-state.repository.js";
