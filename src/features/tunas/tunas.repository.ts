import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../infrastructure/prisma";
import type { TunasAction, TunasMessageRecord, TunasMissionReference } from "./tunas.types";
import { isStepTransitionAllowed } from "../missions/mission.service";
import { parseOperationalReport, type OperationalImpact, type OperationalReportInput } from "./operational-report";
import { ApiError } from "../../shared/api-error";

const messageSelect = { tunasMessageId: true, missionId: true, kind: true, role: true, content: true, actions: true, readAt: true, telegramSentAt: true, telegramMessageId: true, createdAt: true, mission: { select: { missionId: true, originalMessage: true, status: true, stage: true } } } as const;
const actions = (value: unknown) => Array.isArray(value) ? value as TunasAction[] : [];
const record = (value: { tunasMessageId: string; missionId: string | null; mission: TunasMissionReference | null; kind: string; role: string; content: string; actions: unknown; readAt: Date | null; telegramSentAt: Date | null; telegramMessageId: string | null; createdAt: Date }): TunasMessageRecord => ({ ...value, actions: actions(value.actions) });

export class TunasRepository {
  async farm(farmId: string) { return getPrisma().farm.findUniqueOrThrow({ where: { farmId } }); }
  async hasChecked(farmId: string, forecastDate: Date) { return Boolean(await getPrisma().tunasForecastCheck.findUnique({ where: { farmId_forecastDate: { farmId, forecastDate } } })); }
  async markChecked(farmId: string, forecastDate: Date) { await getPrisma().tunasForecastCheck.upsert({ where: { farmId_forecastDate: { farmId, forecastDate } }, create: { farmId, forecastDate }, update: {} }); }
  async activeMissions(farmId: string) {
    return getPrisma().mission.findMany({
      where: { farmId, status: "ACTIVE", missionSteps: { some: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } } } },
      include: { fieldBlock: true, constraints: true, missionSteps: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } } } },
      orderBy: { createdAt: "desc" },
    });
  }
  async latestActiveMission(farmId: string) { return (await this.activeMissions(farmId))[0] ?? null; }
  async activeMission(farmId: string, missionId: string) { return getPrisma().mission.findFirst({ where: { farmId, missionId, status: "ACTIVE", missionSteps: { some: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } } } }, include: { fieldBlock: true, missionSteps: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } }, orderBy: { sequence: "asc" } } } }); }
  async latestWeather(farmId: string, fieldBlockId: string) { return getPrisma().weatherSnapshot.findFirst({ where: { farmId, fieldBlockId }, orderBy: { observedAt: "desc" } }); }
  async saveWeather(farmId: string, fieldBlockId: string, payload: unknown) { await getPrisma().weatherSnapshot.create({ data: { farmId, fieldBlockId, source: "open-meteo-daily-check", observedAt: new Date(), payload: payload as Prisma.InputJsonValue } }); }
  async createMessage(input: { farmId: string; missionId?: string | null; kind: string; role?: string; content: string; actions?: TunasAction[]; dedupeKey?: string | null }) {
    const create = { ...input, actions: (input.actions ?? []) as Prisma.InputJsonValue };
    const value = input.dedupeKey
      ? await getPrisma().tunasMessage.upsert({ where: { farmId_dedupeKey: { farmId: input.farmId, dedupeKey: input.dedupeKey } }, create, update: {}, select: messageSelect })
      : await getPrisma().tunasMessage.create({ data: create, select: messageSelect });
    return record(value);
  }
  async pendingTelegramMessages(farmId: string) { return (await getPrisma().tunasMessage.findMany({ where: { farmId, missionId: { not: null }, dedupeKey: { not: null }, telegramSentAt: null, kind: { in: ["drying-rain", "harvest-rain", "irregular-rain"] } }, orderBy: { createdAt: "asc" }, select: messageSelect })).map(record); }
  async markTelegramSent(farmId: string, tunasMessageId: string, telegramMessageId: string) { await getPrisma().tunasMessage.updateMany({ where: { farmId, tunasMessageId, telegramSentAt: null }, data: { telegramSentAt: new Date(), telegramMessageId } }); }
  async deleteMessage(farmId: string, tunasMessageId: string) { await getPrisma().tunasMessage.deleteMany({ where: { farmId, tunasMessageId, telegramSentAt: null } }); }
  async messages(farmId: string) {
    const [items, unread] = await Promise.all([
      getPrisma().tunasMessage.findMany({ where: { farmId }, orderBy: { createdAt: "desc" }, take: 20, select: messageSelect }),
      getPrisma().tunasMessage.count({ where: { farmId, readAt: null } }),
    ]);
    return { messages: items.reverse().map(record), unreadCount: unread };
  }
  async markRead(farmId: string) { await getPrisma().tunasMessage.updateMany({ where: { farmId, readAt: null }, data: { readAt: new Date() } }); return this.messages(farmId); }
  async message(farmId: string, tunasMessageId: string) { const value = await getPrisma().tunasMessage.findFirst({ where: { farmId, tunasMessageId }, select: messageSelect }); return value ? record(value) : null; }
  async consumeAction(farmId: string, tunasMessageId: string) { await getPrisma().tunasMessage.updateMany({ where: { farmId, tunasMessageId }, data: { actions: [] as Prisma.InputJsonValue, readAt: new Date() } }); }

  async mission(farmId: string, missionId: string) {
    return getPrisma().mission.findFirst({ where: { farmId, missionId }, include: { missionSteps: { orderBy: { sequence: "asc" } }, constraints: true, closeout: true, operationalReports: { orderBy: { acceptedAt: "desc" }, take: 20 } } });
  }

  async currentMission(farmId: string) {
    return getPrisma().mission.findFirst({ where: { farmId, status: { in: ["ACTIVE", "CLOSEOUT"] } }, include: { missionSteps: { orderBy: { sequence: "asc" } }, constraints: true, closeout: true, operationalReports: { orderBy: { acceptedAt: "desc" }, take: 20 } }, orderBy: { updatedAt: "desc" } });
  }

  async interactions(farmId: string) {
    return getPrisma().operationalInteraction.findMany({
      where: { farmId, status: "COMPLETED", response: { not: Prisma.DbNull } },
      select: { operationalInteractionId: true, message: true, response: true, createdAt: true, completedAt: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  }

  async beginInteraction(input: { farmId: string; missionId: string | null; channel: string; externalMessageId: string; message: string }) {
    const prisma = getPrisma();
    const duplicate = await prisma.operationalInteraction.findUnique({ where: { farmId_channel_externalMessageId: { farmId: input.farmId, channel: input.channel, externalMessageId: input.externalMessageId } } });
    if (duplicate) return { interaction: duplicate, duplicate: true };
    try {
      return await prisma.$transaction(async (tx) => {
        const pending = await tx.pendingAction.findFirst({ where: { farmId: input.farmId, missionId: input.missionId, status: "PENDING", thread: { channel: input.channel } }, orderBy: { createdAt: "desc" } });
        const thread = pending
          ? await tx.operationalThread.findUniqueOrThrow({ where: { operationalThreadId: pending.operationalThreadId } })
          : await tx.operationalThread.create({ data: { farmId: input.farmId, missionId: input.missionId, channel: input.channel } });
        const interaction = await tx.operationalInteraction.create({ data: { ...input, operationalThreadId: thread.operationalThreadId } });
        await tx.operationalEvent.create({ data: { operationalThreadId: thread.operationalThreadId, operationalInteractionId: interaction.operationalInteractionId, farmId: input.farmId, missionId: input.missionId, actor: input.channel === "scheduled" ? "system" : "farmer", channel: input.channel, type: "INTERACTION_RECEIVED", after: { message: input.message } } });
        return { interaction, duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const interaction = await prisma.operationalInteraction.findUniqueOrThrow({ where: { farmId_channel_externalMessageId: { farmId: input.farmId, channel: input.channel, externalMessageId: input.externalMessageId } } });
        return { interaction, duplicate: true };
      }
      throw error;
    }
  }

  async openPending(threadId: string) { return getPrisma().pendingAction.findFirst({ where: { operationalThreadId: threadId, status: "PENDING" }, orderBy: { createdAt: "desc" } }); }

  async createPending(input: { threadId: string; interactionId: string; farmId: string; missionId: string | null; channel: string; kind: string; preview: unknown; expectedState?: unknown }) {
    return getPrisma().$transaction(async (tx) => {
      const superseded = await tx.pendingAction.findMany({ where: { operationalThreadId: input.threadId, status: "PENDING" } });
      await tx.pendingAction.updateMany({ where: { operationalThreadId: input.threadId, status: "PENDING" }, data: { status: "SUPERSEDED", resolvedAt: new Date(), version: { increment: 1 } } });
      if (superseded.length) await tx.operationalEvent.createMany({ data: superseded.map((item) => ({ operationalThreadId: input.threadId, operationalInteractionId: input.interactionId, pendingActionId: item.pendingActionId, farmId: input.farmId, missionId: input.missionId, actor: "tunas", channel: input.channel, type: "PENDING_SUPERSEDED", before: item.preview as Prisma.InputJsonValue })) });
      const pending = await tx.pendingAction.create({ data: { operationalThreadId: input.threadId, operationalInteractionId: input.interactionId, farmId: input.farmId, missionId: input.missionId, kind: input.kind, preview: input.preview as Prisma.InputJsonValue, expectedState: input.expectedState as Prisma.InputJsonValue | undefined } });
      await tx.operationalEvent.create({ data: { operationalThreadId: input.threadId, operationalInteractionId: input.interactionId, pendingActionId: pending.pendingActionId, farmId: input.farmId, missionId: input.missionId, actor: "tunas", channel: input.channel, type: input.kind === "CLARIFICATION" ? "CLARIFICATION_REQUESTED" : "MUTATION_PROPOSED", after: input.preview as Prisma.InputJsonValue } });
      return pending;
    });
  }

  async ensurePending(input: { threadId: string; interactionId: string; farmId: string; missionId: string | null; channel: string; kind: string; preview: unknown; expectedState?: unknown }) {
    return await this.openPending(input.threadId) ?? this.createPending(input);
  }

  async resolveClarification(pendingActionId: string, interactionId: string, channel: string) {
    const pending = await getPrisma().pendingAction.update({ where: { pendingActionId }, data: { status: "CLARIFIED", resolvedAt: new Date(), version: { increment: 1 } } });
    await getPrisma().operationalEvent.create({ data: { operationalThreadId: pending.operationalThreadId, operationalInteractionId: interactionId, pendingActionId, farmId: pending.farmId, missionId: pending.missionId, actor: "farmer", channel, type: "CLARIFICATION_RECEIVED" } });
    return pending;
  }

  async auditRoute(state: { threadId: string; interactionId: string; farmId: string; missionId: string | null; channel: string }, route: { trigger: string; routingSource: string; routingFailure: string | null }) {
    await getPrisma().operationalEvent.create({ data: { operationalThreadId: state.threadId, operationalInteractionId: state.interactionId, farmId: state.farmId, missionId: state.missionId, actor: "tunas", channel: state.channel, type: "INTERACTION_ROUTED", metadata: route as Prisma.InputJsonValue } });
  }

  async auditResponse(state: { threadId: string; interactionId: string; farmId: string; missionId: string | null; channel: string }, response: unknown) {
    await getPrisma().operationalEvent.create({ data: { operationalThreadId: state.threadId, operationalInteractionId: state.interactionId, farmId: state.farmId, missionId: state.missionId, actor: "tunas", channel: state.channel, type: "GRAPH_RESPONSE_READY", after: response as Prisma.InputJsonValue } });
  }

  async completeInteraction(interactionId: string, trigger: string, response: unknown) {
    return getPrisma().$transaction(async (tx) => {
      const interaction = await tx.operationalInteraction.update({ where: { operationalInteractionId: interactionId }, data: { trigger, status: "COMPLETED", response: response as Prisma.InputJsonValue, completedAt: new Date() } });
      await tx.operationalEvent.create({ data: { operationalThreadId: interaction.operationalThreadId, operationalInteractionId: interaction.operationalInteractionId, farmId: interaction.farmId, missionId: interaction.missionId, actor: "tunas", channel: interaction.channel, type: "INTERACTION_COMPLETED", after: { trigger, response } as Prisma.InputJsonValue } });
      return interaction;
    });
  }

  async updateInteractionResponse(interactionId: string, response: unknown) {
    await getPrisma().operationalInteraction.update({ where: { operationalInteractionId: interactionId }, data: { response: response as Prisma.InputJsonValue } });
  }

  async failInteraction(interactionId: string, failure: string) {
    return getPrisma().$transaction(async (tx) => {
      const interaction = await tx.operationalInteraction.update({ where: { operationalInteractionId: interactionId }, data: { status: "FAILED", completedAt: new Date() } });
      await tx.operationalEvent.create({ data: { operationalThreadId: interaction.operationalThreadId, operationalInteractionId: interactionId, farmId: interaction.farmId, missionId: interaction.missionId, actor: "tunas", channel: interaction.channel, type: "INTERACTION_FAILED", metadata: { failure } } });
    });
  }

  async pending(farmId: string, pendingActionId: string) { return getPrisma().pendingAction.findFirst({ where: { farmId, pendingActionId }, include: { thread: true } }); }

  async resolvePending(input: { pendingActionId: string; status: "APPROVED" | "REJECTED" | "STALE"; channel: string; before?: unknown; after?: unknown; resolution?: unknown }) {
    return getPrisma().$transaction(async (tx) => {
      const pending = await tx.pendingAction.findUniqueOrThrow({ where: { pendingActionId: input.pendingActionId } });
      const changed = await tx.pendingAction.updateMany({ where: { pendingActionId: input.pendingActionId, status: "PENDING", version: pending.version }, data: { status: input.status, resolution: input.resolution as Prisma.InputJsonValue | undefined, resolvedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) return tx.pendingAction.findUniqueOrThrow({ where: { pendingActionId: input.pendingActionId } });
      await tx.operationalEvent.create({ data: { operationalThreadId: pending.operationalThreadId, operationalInteractionId: pending.operationalInteractionId, pendingActionId: pending.pendingActionId, farmId: pending.farmId, missionId: pending.missionId, actor: "farmer", channel: input.channel, type: `PENDING_${input.status}`, before: input.before as Prisma.InputJsonValue | undefined, after: input.after as Prisma.InputJsonValue | undefined, metadata: input.resolution as Prisma.InputJsonValue | undefined } });
      return tx.pendingAction.findUniqueOrThrow({ where: { pendingActionId: input.pendingActionId } });
    });
  }

  async updateNotes(farmId: string, missionId: string, expectedUpdatedAt: Date, notes: string | null) {
    const changed = await getPrisma().mission.updateMany({ where: { farmId, missionId, updatedAt: expectedUpdatedAt }, data: { notes, revision: { increment: 1 } } });
    return changed.count === 1 ? this.mission(farmId, missionId) : null;
  }

  async timeline(farmId: string, missionId: string) {
    return getPrisma().operationalEvent.findMany({ where: { farmId, missionId }, orderBy: [{ createdAt: "asc" }, { operationalEventId: "asc" }] });
  }

  async reports(farmId: string, missionId: string) {
    return getPrisma().operationalReport.findMany({ where: { farmId, missionId }, orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }] });
  }

  async acceptReport(input: { farmId: string; pendingActionId: string; expectedRevision: number; channel: string }) {
    return getPrisma().$transaction(async (tx) => {
      const pending = await tx.pendingAction.findFirst({ where: { pendingActionId: input.pendingActionId, farmId: input.farmId, status: "PENDING", kind: "OPERATIONAL_REPORT" } });
      if (!pending?.missionId) return null;
      const mission = await tx.mission.findFirst({ where: { farmId: input.farmId, missionId: pending.missionId, revision: input.expectedRevision }, include: { missionSteps: { orderBy: { sequence: "asc" } }, constraints: true } });
      if (!mission) return null;
      const report = parseOperationalReport((pending.preview as { after?: unknown }).after);
      if (report.missionStepId && !mission.missionSteps.some((step) => step.missionStepId === report.missionStepId)) throw new ApiError(409, "Report activity does not belong to this mission");
      if (report.fieldBlockId && report.fieldBlockId !== mission.fieldBlockId) throw new ApiError(409, "Report field does not belong to this mission");
      if (report.cropBatchId && !await tx.missionCropBatch.findUnique({ where: { missionId_cropBatchId: { missionId: mission.missionId, cropBatchId: report.cropBatchId } } })) throw new ApiError(409, "Report crop batch does not belong to this mission");
      if (report.supersedesReportId && !await tx.operationalReport.findFirst({ where: { operationalReportId: report.supersedesReportId, missionId: mission.missionId } })) throw new ApiError(409, "Superseded report does not belong to this mission");
      const requestedStatus = report.reportType === "ACTIVITY_STARTED" ? "IN_PROGRESS" : report.reportType === "ACTIVITY_COMPLETED" ? "COMPLETED" : null;
      const revision = await tx.mission.updateMany({ where: { missionId: mission.missionId, revision: input.expectedRevision }, data: { revision: { increment: 1 } } });
      if (!revision.count) return null;
      if (requestedStatus) {
        const step = mission.missionSteps.find((item) => item.missionStepId === report.missionStepId)!;
        if (mission.status !== "ACTIVE" || step.stage !== mission.stage || !isStepTransitionAllowed(step as never, requestedStatus, mission.missionSteps as never[])) throw new ApiError(409, "Reported activity transition is not allowed");
        if (step.status !== requestedStatus) await tx.missionStep.update({ where: { missionStepId: step.missionStepId }, data: { status: requestedStatus } });
      }
      const accepted = await tx.operationalReport.create({ data: { farmId: mission.farmId, missionId: mission.missionId, missionStepId: report.missionStepId, fieldBlockId: report.fieldBlockId, cropBatchId: report.cropBatchId, operationalInteractionId: pending.operationalInteractionId, channel: input.channel, reportType: report.reportType, observedAt: new Date(report.observedAt), payload: report.payload as Prisma.InputJsonValue, narrative: report.narrative, supersedesReportId: report.supersedesReportId } });
      const impact = reportImpact(report, mission);
      await tx.pendingAction.update({ where: { pendingActionId: pending.pendingActionId }, data: { status: "APPROVED", resolvedAt: new Date(), version: { increment: 1 }, resolution: { operationalReportId: accepted.operationalReportId, impact } as Prisma.InputJsonValue } });
      await tx.operationalEvent.createMany({ data: [
        { operationalThreadId: pending.operationalThreadId, operationalInteractionId: pending.operationalInteractionId, pendingActionId: pending.pendingActionId, farmId: mission.farmId, missionId: mission.missionId, actor: "farmer", channel: input.channel, type: "REPORT_ACCEPTED", after: { operationalReportId: accepted.operationalReportId, reportType: report.reportType } },
        { operationalThreadId: pending.operationalThreadId, operationalInteractionId: pending.operationalInteractionId, pendingActionId: pending.pendingActionId, farmId: mission.farmId, missionId: mission.missionId, actor: "tunas", channel: input.channel, type: "REPORT_IMPACT_EVALUATED", metadata: impact as Prisma.InputJsonValue },
      ] });
      return { report: accepted, impact, pending: await tx.pendingAction.findUniqueOrThrow({ where: { pendingActionId: pending.pendingActionId } }) };
    });
  }
}

export function reportImpact(report: OperationalReportInput, mission: { status: string; stage: string; missionSteps: Array<{ status: string; startsOn: Date; endsOn: Date; stage: string }>; constraints: Array<{ key: string; value: unknown }> }): OperationalImpact {
  const reasons: string[] = [];
  if (report.reportType === "BUYER_REQUIREMENT_CHANGED") reasons.push("Buyer target or deadline changed");
  if (report.reportType === "ACTUAL_QUANTITY_REPORTED") {
    const target = mission.constraints.find((item) => ["plannedHarvestKg", "plannedDriedKg"].includes(item.key))?.value;
    if (typeof target === "number" && report.payload.quantityKg !== target) reasons.push("Actual quantity differs from target");
  }
  if (report.reportType === "DRYING_RESOURCE_CHANGED" && !report.payload.available) reasons.push("Drying resource is unavailable");
  if (report.reportType === "WORKER_AVAILABILITY_CHANGED" && report.payload.availableWorkers === 0 && mission.missionSteps.some((step) => step.status === "IN_PROGRESS")) reasons.push("No workers are available during active work");
  if (report.reportType === "RAIN_OR_FIELD_EVENT") {
    const observed = report.payload.observedAt.slice(0, 10);
    if (mission.missionSteps.some((step) => step.status !== "COMPLETED" && ["HARVESTING", "DRYING"].includes(step.stage) && step.startsOn.toISOString().slice(0, 10) <= observed && step.endsOn.toISOString().slice(0, 10) >= observed)) reasons.push("Rain or field event overlaps remaining exposed work");
  }
  return { level: reasons.length ? "MATERIAL" : "NONE", reasons, replanSupported: report.reportType === "BUYER_REQUIREMENT_CHANGED" && reasons.length > 0 && mission.status === "ACTIVE" };
}
