import { getPrisma } from "../../infrastructure/prisma";

export class GoogleCalendarRepository {
  connection(farmId: string) {
    return getPrisma().googleCalendarConnection.findUnique({ where: { farmId } });
  }

  saveConnection(input: { farmId: string; encryptedAccessToken: string; encryptedRefreshToken: string; tokenExpiresAt: Date; scopes: string }) {
    return getPrisma().googleCalendarConnection.upsert({
      where: { farmId: input.farmId },
      create: { ...input, calendarId: "primary" },
      update: { encryptedAccessToken: input.encryptedAccessToken, encryptedRefreshToken: input.encryptedRefreshToken, tokenExpiresAt: input.tokenExpiresAt, scopes: input.scopes },
    });
  }

  updateToken(farmId: string, input: { encryptedAccessToken: string; tokenExpiresAt: Date }) {
    return getPrisma().googleCalendarConnection.update({ where: { farmId }, data: input });
  }

  disconnect(farmId: string) {
    return getPrisma().googleCalendarConnection.deleteMany({ where: { farmId } });
  }

  syncedEvents(farmId: string, missionId?: string) {
    return getPrisma().planStep.findMany({
      where: { googleCalendarEventId: { not: null }, plan: { mission: { farmId, ...(missionId ? { missionId } : {}) } } },
      select: { planStepId: true, googleCalendarEventId: true, plan: { select: { missionId: true } } },
    });
  }

  approvedActiveMissions(farmId: string) {
    return getPrisma().mission.findMany({
      where: { farmId, status: "ACTIVE", approvedPlanId: { not: null } },
      select: {
        missionId: true, approvedPlanId: true,
        plans: { select: { planId: true, steps: { select: { planStepId: true, sequence: true, title: true, description: true, actionKind: true, scheduleType: true, startsOn: true, endsOn: true, windowStart: true, windowEnd: true, timezone: true, stage: true, targetHarvestKg: true, googleCalendarEventId: true }, orderBy: { sequence: "asc" } } } },
      },
    });
  }

  async markSynced(planStepId: string, missionId: string, eventId: string) {
    await getPrisma().$transaction([
      getPrisma().planStep.update({ where: { planStepId }, data: { calendarSyncStatus: "SYNCED", googleCalendarEventId: eventId } }),
      getPrisma().missionStep.updateMany({ where: { missionId, sourcePlanStepId: planStepId }, data: { calendarSyncStatus: "SYNCED", googleCalendarEventId: eventId } }),
    ]);
  }

  async markFailed(planStepId: string, missionId: string) {
    await getPrisma().$transaction([
      getPrisma().planStep.update({ where: { planStepId }, data: { calendarSyncStatus: "FAILED" } }),
      getPrisma().missionStep.updateMany({ where: { missionId, sourcePlanStepId: planStepId }, data: { calendarSyncStatus: "FAILED" } }),
    ]);
  }

  async clearSynced(planStepId: string, missionId: string) {
    await getPrisma().$transaction([
      getPrisma().planStep.update({ where: { planStepId }, data: { calendarSyncStatus: "NOT_REQUESTED", googleCalendarEventId: null } }),
      getPrisma().missionStep.updateMany({ where: { missionId, sourcePlanStepId: planStepId }, data: { calendarSyncStatus: "NOT_REQUESTED", googleCalendarEventId: null } }),
    ]);
  }
}
