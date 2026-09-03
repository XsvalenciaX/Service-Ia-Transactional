import {
  applianceRepository,
  ApplianceType,
  type Appliance,
} from "@energy-bot/database";

export { ApplianceType };

export interface ApplianceAnswer {
  frequencyPerWeek?: number;
  usageNote?: string;
}

export async function saveApplianceAnswer(
  userId: string,
  type: ApplianceType,
  answer: ApplianceAnswer
): Promise<Appliance> {
  return applianceRepository.create({
    userId,
    type,
    frequencyPerWeek: answer.frequencyPerWeek,
    usageNote: answer.usageNote,
  });
}

export async function getAppliancesForUser(userId: string): Promise<Appliance[]> {
  return applianceRepository.findAllByUserId(userId);
}
