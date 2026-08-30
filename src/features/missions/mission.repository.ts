import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../infrastructure/prisma";
import type { FactBlock, GeneratedPlan, MessageInput, MissionFact, MissionRecord } from "./mission.types";

const record = (value: unknown) => value as MissionRecord;
const details = { messages: { orderBy: { createdAt: "asc" } }, constraints: true, cropBatches: { include: { cropBatch: true } }, planningRuns: { orderBy: { createdAt: "desc" }, include: { plans: { include: { steps: { orderBy: { sequence: "asc" } } } } } }, missionSteps: { orderBy: { sequence: "asc" } }, closeout: true } as const;
export const missionConfirmationTransactionOptions = { timeout: 15_000 } as const;
const listDetails = {
  missionId: true, fieldBlockId: true, status: true, stage: true, originalMessage: true, createdAt: true,
  cropBatches: { select: { cropBatchId: true, cropBatch: { select: { cropBatchId: true, variety: true } } } },
  missionSteps: { orderBy: { sequence: "asc" }, select: { missionStepId: true, sequence: true, title: true, description: true, startsOn: true, endsOn: true, windowStart: true, windowEnd: true, timezone: true, isConditional: true, stage: true, status: true } },
} as const;

export function planCreateData(missionId: string, planningRunId: string, plan: GeneratedPlan) {
  const { activities, assumptions, risks, evidence: _evidence, tradeoffs: _tradeoffs, planId: _previewPlanId, ...details } = plan;
  return { missionId, planningRunId, ...details, assumptions: assumptions as Prisma.InputJsonValue, risks: risks as Prisma.InputJsonValue, steps: { create: activities.map((activity, sequence) => ({ sequence: sequence + 1, title: activity.title, description: activity.description, scheduleType: activity.scheduleType, startsOn: new Date(`${activity.startsOn}T00:00:00.000Z`), endsOn: new Date(`${activity.endsOn}T00:00:00.000Z`), windowStart: activity.windowStart, windowEnd: activity.windowEnd, timezone: activity.timezone, isConditional: activity.isConditional, stage: activity.stage, targetHarvestKg: activity.targetHarvestKg ?? null })) } };
}

export class MissionRepository {
  async list(farmId: string) { return (await getPrisma().mission.findMany({ where: { farmId }, select: listDetails, orderBy: { createdAt: "desc" } })).map(record); }
  async current(farmId: string) { const value = await getPrisma().mission.findFirst({ where: { farmId, status: { in: ["ACTIVE", "CLOSEOUT"] } }, include: details, orderBy: { updatedAt: "desc" } }); return value ? record(value) : null; }
  async calendar(farmId: string, from: Date, to: Date) {
    return (await getPrisma().missionStep.findMany({
      where: { mission: { farmId, approvedPlanId: { not: null } }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsOn: { lte: to }, endsOn: { gte: from } },
      select: { missionStepId: true, missionId: true, sequence: true, title: true, description: true, scheduleType: true, startsOn: true, endsOn: true, windowStart: true, windowEnd: true, timezone: true, isConditional: true, stage: true, status: true, targetHarvestKg: true, mission: { select: { originalMessage: true } } },
      orderBy: [{ startsOn: "asc" }, { sequence: "asc" }],
    })).map(record);
  }
  async find(farmId: string, missionId: string) { const value = await getPrisma().mission.findFirst({ where: { farmId, missionId }, include: details }); return value ? record(value) : null; }
  async delete(farmId: string, missionId: string) { return (await getPrisma().mission.deleteMany({ where: { farmId, missionId } })).count === 1; }

  async context(farmId: string, fieldBlockId?: string | null) {
    const prisma = getPrisma();
    const [farm, fields, cropBatches, outcomes] = await Promise.all([
      prisma.farm.findUniqueOrThrow({ where: { farmId }, include: { owner: true } }), prisma.fieldBlock.findMany({ where: { farmId } }), prisma.cropBatch.findMany({ where: { farmId } }),
      prisma.missionCloseout.findMany({ where: { mission: { farmId, status: "COMPLETED" } }, include: { mission: { select: { fieldBlockId: true, originalMessage: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const history = outcomes.sort((a, b) => Number(b.mission.fieldBlockId === fieldBlockId) - Number(a.mission.fieldBlockId === fieldBlockId));
    return { farm, fields, cropBatches, history };
  }

  async createConfirmed(input: { missionId: string; farmId: string; originalMessage: string; messages: MessageInput[]; facts: MissionFact; blocks: FactBlock[]; plan: GeneratedPlan; weather: Prisma.InputJsonValue; traceId?: string | null }) {
    const prisma = getPrisma();
    const missionId = await prisma.$transaction(async (tx) => {
      const mission = await tx.mission.create({ data: { missionId: input.missionId, farmId: input.farmId, fieldBlockId: input.facts.fieldBlockId, status: "ACTIVE", stage: "WAITING", originalMessage: input.originalMessage, notes: input.facts.notes, messages: { create: input.messages.map((message) => ({ role: message.role, content: message.content })) }, cropBatches: { create: input.facts.cropBatchIds.map((cropBatchId): Prisma.MissionCropBatchUncheckedCreateWithoutMissionInput => ({ cropBatchId })) }, constraints: { create: input.blocks.map((block) => ({ key: block.key, value: block.value as Prisma.InputJsonValue, provenance: block.provenance, confidence: block.confidence })) } } });
      const run = await tx.planningRun.create({ data: { missionId: mission.missionId, status: "SUCCEEDED", traceId: input.traceId ?? null, completedAt: new Date() } });
      const plan = await tx.plan.create({ data: planCreateData(mission.missionId, run.planningRunId, input.plan), include: { steps: { orderBy: { sequence: "asc" } } } });
      await tx.missionStep.createMany({ data: plan.steps.map((step) => ({ missionId: mission.missionId, sourcePlanStepId: step.planStepId, sequence: step.sequence, title: step.title, description: step.description, scheduleType: step.scheduleType, startsOn: step.startsOn, endsOn: step.endsOn, windowStart: step.windowStart, windowEnd: step.windowEnd, timezone: step.timezone, isConditional: step.isConditional, stage: step.stage, targetHarvestKg: step.targetHarvestKg })) });
      await tx.weatherSnapshot.create({ data: { farmId: input.farmId, fieldBlockId: input.facts.fieldBlockId as string, source: "open-meteo", observedAt: new Date(), payload: input.weather } });
      await tx.mission.update({ where: { missionId: mission.missionId }, data: { approvedPlanId: plan.planId } });
      return mission.missionId;
    }, missionConfirmationTransactionOptions);
    return record(await prisma.mission.findUniqueOrThrow({ where: { missionId }, include: details }));
  }

  async replaceConfirmedPlan(input: { missionId: string; farmId: string; expectedPlanId: string | null; expectedUpdatedAt: Date; messages: MessageInput[]; facts: MissionFact; blocks: FactBlock[]; plan: GeneratedPlan; weather: Prisma.InputJsonValue; traceId?: string | null }) {
    const prisma = getPrisma();
    await prisma.$transaction(async (tx) => {
      const existingSteps = await tx.missionStep.findMany({ where: { missionId: input.missionId }, orderBy: { sequence: "asc" } });
      const completed = existingSteps.filter((step) => step.status === "COMPLETED");
      const stage = completed.some((step) => step.stage === "DRYING") ? "FINISHED" : completed.some((step) => step.stage === "HARVESTING") ? "DRYING" : "WAITING";
      const changed = await tx.mission.updateMany({ where: { missionId: input.missionId, farmId: input.farmId, status: "ACTIVE", approvedPlanId: input.expectedPlanId, updatedAt: input.expectedUpdatedAt }, data: { stage, revision: { increment: 1 } } });
      if (!changed.count) throw new Error("stale-mission");
      await tx.mission.update({ where: { missionId: input.missionId }, data: {
        fieldBlockId: input.facts.fieldBlockId, notes: input.facts.notes,
        messages: { create: input.messages.map((message) => ({ role: message.role, content: message.content })) },
        cropBatches: { deleteMany: {}, create: input.facts.cropBatchIds.map((cropBatchId) => ({ cropBatchId })) },
        constraints: { deleteMany: {}, create: input.blocks.map((block) => ({ key: block.key, value: block.value as Prisma.InputJsonValue, provenance: block.provenance, confidence: block.confidence })) },
      } });
      const run = await tx.planningRun.create({ data: { missionId: input.missionId, status: "SUCCEEDED", traceId: input.traceId ?? null, completedAt: new Date() } });
      const plan = await tx.plan.create({ data: planCreateData(input.missionId, run.planningRunId, input.plan), include: { steps: { orderBy: { sequence: "asc" } } } });
      await tx.missionStep.deleteMany({ where: { missionId: input.missionId, status: { not: "COMPLETED" } } });
      await tx.missionStep.createMany({ data: plan.steps.map((step, index) => ({ missionId: input.missionId, sourcePlanStepId: step.planStepId, sequence: completed.length + index + 1, title: step.title, description: step.description, scheduleType: step.scheduleType, startsOn: step.startsOn, endsOn: step.endsOn, windowStart: step.windowStart, windowEnd: step.windowEnd, timezone: step.timezone, isConditional: step.isConditional, stage: step.stage, targetHarvestKg: step.targetHarvestKg })) });
      await tx.weatherSnapshot.create({ data: { farmId: input.farmId, fieldBlockId: input.facts.fieldBlockId as string, source: "open-meteo", observedAt: new Date(), payload: input.weather } });
      await tx.mission.update({ where: { missionId: input.missionId }, data: { approvedPlanId: plan.planId } });
    }, missionConfirmationTransactionOptions).catch((error: unknown) => { if (error instanceof Error && error.message === "stale-mission") throw error; throw error; });
    return record(await prisma.mission.findUniqueOrThrow({ where: { missionId: input.missionId }, include: details }));
  }

  async advance(farmId: string, missionId: string, expectedStage: string, stage: string, status: string) {
    const result = await getPrisma().mission.updateMany({ where: { farmId, missionId, status: "ACTIVE", stage: expectedStage }, data: { stage, status, revision: { increment: 1 } } });
    return result.count === 1 ? this.find(farmId, missionId) : null;
  }

  async updateStepStatus(farmId: string, missionId: string, stepId: string, expectedStatus: string, status: string) {
    const changed = await getPrisma().$transaction(async (tx) => {
      const result = await tx.missionStep.updateMany({ where: { missionStepId: stepId, missionId, status: expectedStatus, mission: { farmId } }, data: { status } });
      if (result.count === 1) await tx.mission.update({ where: { missionId }, data: { revision: { increment: 1 } } });
      return result.count;
    });
    return changed === 1 ? this.find(farmId, missionId) : null;
  }

  async recordCloseout(farmId: string, missionId: string, values: { actualHarvestKg: number; actualDriedKg: number; harvestedAreaHectares: number | null; dryingCompleted: boolean; rejectedKg: number | null; notes: string | null; plannedHarvestKg: number; plannedDriedKg: number }) {
    return record(await getPrisma().$transaction(async (tx) => {
      const mission = await tx.mission.findFirst({ where: { farmId, missionId, status: "CLOSEOUT", stage: "TO_REVIEW" } });
      if (!mission) return null;
      await tx.missionCloseout.create({ data: { missionId, ...values } });
      await tx.mission.update({ where: { missionId }, data: { revision: { increment: 1 } } });
      return tx.mission.findUniqueOrThrow({ where: { missionId }, include: details });
    }) as unknown as MissionRecord);
  }

  async confirmCloseout(farmId: string, missionId: string) {
    const result = await getPrisma().mission.updateMany({ where: { farmId, missionId, status: "CLOSEOUT", stage: "TO_REVIEW", closeout: { isNot: null } }, data: { status: "COMPLETED", stage: "COMPLETED", revision: { increment: 1 } } });
    return result.count === 1 ? this.find(farmId, missionId) : null;
  }
}
