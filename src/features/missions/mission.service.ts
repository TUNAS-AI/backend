import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { traceAgentOperation } from "../../agent/tracing";
import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { MissionAgent, MissionInterpretationOutputError } from "../../agent/missions/mission-agent";
import { getOpenMeteoForecast } from "../../agent/missions/open-meteo.client";
import { signPreview, verifyPreview } from "./mission-preview-token";
import { MissionRepository } from "./mission.repository";
import { GoogleCalendarService } from "../google-calendar/google-calendar.service";
import { applyScheduleEdit, generateFeasiblePlans, validatePlan } from "./deterministic-planner";
import type { DryingProfile, FactBlock, MessageInput, MissionCandidate, MissionCloseoutInput, MissionFact, MissionFactKey, MissionRecord, MissionStage, MissionStatus, MissionStepStatus, PlannedActivity, ScheduleChange, ScheduleEdit } from "./mission.types";
import type { OperationalReportInput } from "../tunas/operational-report";

const stages: Record<Exclude<MissionStage, "COMPLETED">, Exclude<MissionStage, "WAITING" | "COMPLETED"> | undefined> = { WAITING: "HARVESTING", HARVESTING: "DRYING", DRYING: "FINISHED", FINISHED: "TO_REVIEW", TO_REVIEW: undefined };
export const nextMissionStage = (stage: string) => stages[stage as keyof typeof stages];
export function missionVersionTimestamp(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new ApiError(409, "Mission version timestamp is invalid");
  return date.toISOString();
}
type StoredStep = { missionStepId: string; sequence: number; stage: "HARVESTING" | "DRYING"; status: MissionStepStatus };
type ReplanPreviewPayload = { exp: number; kind: "replan"; farmId: string; missionId: string; expectedPlanId: string | null; expectedRevision: number; messageCount: number; stateHash: string; candidate: MissionCandidate; plans: import("./mission.types").GeneratedPlan[]; observedRainAt?: string; scheduleEdit?: ScheduleEdit; changes?: ScheduleChange[]; traceId?: string };

export function canAdvanceMissionStage(stage: string, steps: StoredStep[]) {
  if (stage === "WAITING") return true;
  const relevant = stage === "FINISHED" ? steps : steps.filter((step) => step.stage === stage);
  return relevant.length > 0 && relevant.every((step) => step.status === "COMPLETED");
}

export function isStepTransitionAllowed(step: StoredStep, requestedStatus: MissionStepStatus, steps: StoredStep[]) {
  if (step.status === requestedStatus) return true;
  if (requestedStatus === "IN_PROGRESS") return step.status === "SCHEDULED" && steps.filter((item) => item.stage === step.stage && item.sequence < step.sequence).every((item) => item.status === "COMPLETED") && !steps.some((item) => item.stage === step.stage && item.status === "IN_PROGRESS");
  return requestedStatus === "COMPLETED" && ["SCHEDULED", "IN_PROGRESS"].includes(step.status) && steps.filter((item) => item.stage === step.stage && item.sequence < step.sequence).every((item) => item.status === "COMPLETED");
}
export function planningUnavailable(error: unknown) {
  if (error instanceof ApiError) return error;
  return new ApiError(503, "TUNAS could not produce a complete plan. Retry planning in a moment.");
}
export function logPlanningFailure(missionId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const kind = /targetHarvestKg|output failed validation|failed to parse/i.test(message) ? "output_validation_failure" : "provider_failure";
  console.warn("Mission planning failed", { missionId, kind });
}
export function interpretationUnavailable(error: unknown) {
  if (error instanceof ApiError) return error;
  return new ApiError(503, "TUNAS could not interpret this request. Retry in a moment.");
}
export function logInterpretationFailure(previewId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const kind = error instanceof MissionInterpretationOutputError || /failed to parse|output_parsing_failure|output failed validation/i.test(message) ? "output_parsing_failure" : "provider_failure";
  console.warn("Mission interpretation failed", { previewId, kind });
}
const factKeys: MissionFactKey[] = ["fieldBlockId", "cropBatchIds", "readinessConfirmed", "destination", "plannedHarvestKg", "deadlineAt", "notes", "workers", "harvestDurationMinutes"];
const optional = new Set<MissionFactKey>(["notes", "workers", "harvestDurationMinutes"]);
const required = factKeys.filter((key) => !optional.has(key));
type HistoricalOutcome = { mission: { fieldBlockId: string | null }; plannedHarvestKg: unknown; plannedDriedKg: unknown; actualHarvestKg: unknown; actualDriedKg: unknown; harvestedAreaHectares: unknown; dryingCompleted: unknown; rejectedKg: unknown; notes: unknown };

function transcript(messages: MessageInput[]) { return messages.map((message) => `${message.role === "assistant" ? "Assistant" : "Farmer"}: ${message.content}`).join("\n"); }
function historicalNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string" && (typeof value !== "object" || value === null)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
export function completedFieldHistory(history: HistoricalOutcome[], fieldBlockId: string) {
  return history.filter((outcome) => outcome.mission.fieldBlockId === fieldBlockId).slice(0, 6).map((outcome) => ({ plannedHarvestKg: historicalNumber(outcome.plannedHarvestKg), plannedDriedKg: historicalNumber(outcome.plannedDriedKg), actualHarvestKg: historicalNumber(outcome.actualHarvestKg), actualDriedKg: historicalNumber(outcome.actualDriedKg), harvestedAreaHectares: historicalNumber(outcome.harvestedAreaHectares), dryingCompleted: typeof outcome.dryingCompleted === "boolean" ? outcome.dryingCompleted : null, rejectedKg: historicalNumber(outcome.rejectedKg), closeoutNotes: typeof outcome.notes === "string" ? outcome.notes : null }));
}
function planningContext(context: Awaited<ReturnType<MissionRepository["context"]>>, candidate: MissionCandidate, responseLanguage?: "id") {
  const { history, ...farmContext } = context;
  return { candidate, context: farmContext, completedMissionHistory: completedFieldHistory(history, candidate.facts.fieldBlockId as string), responseLanguage: responseLanguage ?? null };
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return typeof value === "bigint" ? value.toString() : value;
}
function withObservedRain(weather: unknown, observedAt?: string) {
  if (!observedAt) return weather;
  const value = weather && typeof weather === "object" ? weather as Record<string, unknown> : {};
  const hourly = value.hourly && typeof value.hourly === "object" ? value.hourly as Record<string, unknown> : {};
  const time = Array.isArray(hourly.time) ? [...hourly.time] : [];
  const precipitation = Array.isArray(hourly.precipitation) ? [...hourly.precipitation] : [];
  const probability = Array.isArray(hourly.precipitation_probability) ? [...hourly.precipitation_probability] : [];
  const hour = observedAt.slice(0, 13) + ":00";
  const index = time.indexOf(hour);
  if (index >= 0) precipitation[index] = Math.max(Number(precipitation[index]) || 0, 1);
  else { time.push(hour); precipitation.push(1); probability.push(100); }
  return { ...value, hourly: { ...hourly, time, precipitation, precipitation_probability: probability } };
}
function authoritativeStateHash(context: Awaited<ReturnType<MissionRepository["context"]>>, candidate: MissionCandidate, mission?: MissionRecord) {
  const field = context.fields.find((item) => item.fieldBlockId === candidate.facts.fieldBlockId);
  const batches = context.cropBatches.filter((item) => candidate.facts.cropBatchIds.includes(item.cropBatchId));
  const state = { farm: { timezone: context.farm.timezone, defaultWorkingHours: context.farm.defaultWorkingHours, rainProtectionAvailable: context.farm.rainProtectionAvailable, dryingProfile: context.farm.dryingProfile }, field, batches, facts: candidate.facts, mission: mission ? { approvedPlanId: mission.approvedPlanId, revision: mission.revision, stage: mission.stage, steps: editableSteps(mission) } : null };
  return createHash("sha256").update(JSON.stringify(canonical(state))).digest("hex");
}
function interpretationContext(context: Awaited<ReturnType<MissionRepository["context"]>>, messages: MessageInput[], existingFacts?: MissionFact, responseLanguage?: "id") {
  return {
    farmer: { displayName: context.farm.owner.displayName, locale: context.farm.owner.locale, timezone: context.farm.owner.timezone },
    farm: { name: context.farm.name, location: context.farm.location, notes: context.farm.notes, timezone: context.farm.timezone, defaultWorkingHours: context.farm.defaultWorkingHours, defaultWorkerCount: context.farm.defaultWorkerCount, rainProtectionAvailable: context.farm.rainProtectionAvailable, dryingProfile: context.farm.dryingProfile },
    fields: context.fields.map((field) => ({ fieldBlockId: field.fieldBlockId, name: field.name, areaHectares: field.areaHectares, latitude: field.latitude, longitude: field.longitude, status: field.status, notes: field.notes })),
    cropBatches: context.cropBatches.map((batch) => ({ cropBatchId: batch.cropBatchId, fieldBlockId: batch.fieldBlockId, crop: batch.crop, variety: batch.variety, plantingDate: batch.plantingDate, status: batch.status, readinessStatus: batch.readinessStatus, notes: batch.notes })),
    completedMissionHistory: context.history.map((outcome) => ({ fieldBlockId: outcome.mission.fieldBlockId, originalMessage: outcome.mission.originalMessage, plannedHarvestKg: outcome.plannedHarvestKg, plannedDriedKg: outcome.plannedDriedKg, actualHarvestKg: outcome.actualHarvestKg, actualDriedKg: outcome.actualDriedKg, notes: outcome.notes, summary: outcome.summary })),
    conversation: messages,
    existingFacts: existingFacts ?? null,
    responseLanguage: responseLanguage ?? null,
  };
}
function confidence(value: unknown): "low" | "high" { return value === null || value === "" || (Array.isArray(value) && !value.length) ? "low" : "high"; }
export function applyBatchReadiness(fact: MissionFact, batches: Array<{ cropBatchId: string; readinessStatus?: string | null }>): MissionFact {
  const selected = batches.filter((batch) => fact.cropBatchIds.includes(batch.cropBatchId));
  const readinessConfirmed = selected.length && selected.every((batch) => batch.readinessStatus === "READY") ? true : selected.some((batch) => batch.readinessStatus === "NOT_READY") ? false : null;
  return { ...fact, readinessConfirmed };
}
function review(facts: MissionFact) {
  return factKeys.map((key) => ({ key, status: confidence(facts[key]) === "high" ? "confirmed" as const : "missing" as const, reason: confidence(facts[key]) === "high" ? "Ready for planning." : optional.has(key) ? "Optional; add it if it applies to this method." : "This confirmed operational detail is needed before planning.", provenance: "FARMER_REPORTED" as const, confidence: confidence(facts[key]) }));
}
function blocks(facts: MissionFact): FactBlock[] {
  return factKeys.filter((key) => key !== "notes" && facts[key] !== null && facts[key] !== undefined).map((key) => ({ key, value: facts[key], provenance: key === "fieldBlockId" || key === "cropBatchIds" ? "INFERRED" : "FARMER_REPORTED", confidence: confidence(facts[key]) }));
}

function editableSteps(mission: MissionRecord) {
  return (Array.isArray(mission.missionSteps) ? mission.missionSteps : []).map((value) => {
    const step = value as Record<string, unknown>;
    const date = (item: unknown) => item instanceof Date ? item.toISOString().slice(0, 10) : String(item).slice(0, 10);
    return {
      missionStepId: String(step.missionStepId), sequence: Number(step.sequence), status: String(step.status),
      actionKind: step.actionKind as PlannedActivity["actionKind"], title: String(step.title), description: String(step.description), scheduleType: step.scheduleType as PlannedActivity["scheduleType"],
      startsOn: date(step.startsOn), endsOn: date(step.endsOn), windowStart: typeof step.windowStart === "string" ? step.windowStart : null, windowEnd: typeof step.windowEnd === "string" ? step.windowEnd : null,
      timezone: String(step.timezone), isConditional: Boolean(step.isConditional), stage: step.stage as PlannedActivity["stage"],
      targetHarvestKg: step.targetHarvestKg == null ? null : Number(step.targetHarvestKg), quantityKg: step.quantityKg == null ? null : Number(step.quantityKg),
      dependsOn: Array.isArray(step.dependencies) ? step.dependencies as number[] : [], resourceDemands: Array.isArray(step.resourceDemands) ? step.resourceDemands as PlannedActivity["resourceDemands"] : [],
    };
  });
}

export class MissionService {
  constructor(private readonly repository = new MissionRepository(), private readonly agent = new MissionAgent(), private readonly farmIdForOwner: (ownerId: string) => Promise<string> = callerFarmId, private readonly weatherForecast = getOpenMeteoForecast, private readonly calendarSync = new GoogleCalendarService()) {}

  async list(ownerId: string) { return this.repository.list(await this.farmIdForOwner(ownerId)); }
  async current(ownerId: string) { return this.repository.current(await this.farmIdForOwner(ownerId)); }
  async calendar(ownerId: string, range: { from: Date; to: Date }) { return this.repository.calendar(await this.farmIdForOwner(ownerId), range.from, range.to); }
  async syncCalendar(ownerId: string) { return this.calendarSync.syncIfConnected(await this.farmIdForOwner(ownerId)); }
  async get(ownerId: string, missionId: string) { const mission = await this.repository.find(await this.farmIdForOwner(ownerId), missionId); if (!mission) throw new ApiError(404, "Mission not found"); return mission; }
  async delete(ownerId: string, missionId: string) {
    const farmId = await this.farmIdForOwner(ownerId);
    const calendarCleanup = await this.calendarSync.removeMissionEvents(farmId, missionId);
    const deleted = await this.repository.delete(farmId, missionId);
    if (!deleted) throw new ApiError(404, "Mission not found");
    return { missionId, calendarCleanup };
  }

  private requireActive(mission: MissionRecord) {
    if (mission.status !== "ACTIVE") throw new ApiError(409, "Only active missions can be replanned");
    return mission;
  }

  private factsFromMission(mission: MissionRecord): MissionFact {
    const constraints = Array.isArray(mission.constraints) ? mission.constraints as Array<{ key: string; value: unknown }> : [];
    const value = (key: string) => constraints.find((item) => item.key === key)?.value;
    const cropBatches = Array.isArray(mission.cropBatches) ? mission.cropBatches as Array<{ cropBatchId: string }> : [];
    const facts = {
      fieldBlockId: typeof mission.fieldBlockId === "string" ? mission.fieldBlockId : null,
      cropBatchIds: cropBatches.map((item) => item.cropBatchId),
      notes: typeof mission.notes === "string" ? mission.notes : null,
      workers: typeof value("workers") === "number" ? value("workers") as number : null,
      harvestDurationMinutes: typeof value("harvestDurationMinutes") === "number" ? value("harvestDurationMinutes") as number : null,
      clarification: null,
    } as MissionFact;
    for (const key of factKeys) if (!(key in facts)) (facts as unknown as Record<string, unknown>)[key] = value(key) ?? null;
    return facts;
  }

  async replanDraft(ownerId: string, missionId: string) {
    const farmId = await this.farmIdForOwner(ownerId); const mission = this.requireActive(await this.get(ownerId, missionId));
    const facts = this.factsFromMission(mission); const context = await this.repository.context(farmId, facts.fieldBlockId);
    const messages = (Array.isArray(mission.messages) ? mission.messages : []).map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "farmer" as const, content: String(message.content) }));
    return { previewId: randomUUID(), messages: messages.length ? messages : [{ role: "farmer" as const, content: String(mission.originalMessage) }], facts, review: review(facts), blocks: blocks(facts), manualOptions: this.manualOptions(context) } satisfies MissionCandidate;
  }

  async interpretReplan(ownerId: string, missionId: string, input: { previewId?: string; messages: MessageInput[]; message: string; facts?: MissionFact; responseLanguage?: "id" }) {
    this.requireActive(await this.get(ownerId, missionId));
    return this.interpret(ownerId, input);
  }

  private validateFacts(fact: MissionFact, context: Awaited<ReturnType<MissionRepository["context"]>>) {
    if (fact.fieldBlockId && !context.fields.some((field) => field.fieldBlockId === fact.fieldBlockId)) throw new ApiError(409, "Mission interpretation selected a field block outside this farm");
    if (new Set(fact.cropBatchIds).size !== fact.cropBatchIds.length) throw new ApiError(409, "Mission interpretation repeated a crop batch");
    const selected = context.cropBatches.filter((batch) => fact.cropBatchIds.includes(batch.cropBatchId));
    if (selected.length !== fact.cropBatchIds.length) throw new ApiError(409, "Mission interpretation selected a crop batch outside this farm");
    if (selected.length && (!fact.fieldBlockId || selected.some((batch) => batch.fieldBlockId !== fact.fieldBlockId))) throw new ApiError(409, "Selected crop batches must belong to the selected field block");
  }

  private canonicalCandidate(candidate: MissionCandidate, context: Awaited<ReturnType<MissionRepository["context"]>>) {
    const facts = applyBatchReadiness({ ...candidate.facts, clarification: null }, context.cropBatches);
    this.validateFacts(facts, context);
    return { previewId: candidate.previewId, messages: candidate.messages, facts, review: review(facts), blocks: blocks(facts) } satisfies MissionCandidate;
  }

  private manualOptions(context: Awaited<ReturnType<MissionRepository["context"]>>) {
    return {
      timezone: context.farm.timezone,
      fieldBlocks: context.fields.map((field) => ({ fieldBlockId: field.fieldBlockId, name: field.name })),
      cropBatches: context.cropBatches.map((batch) => ({ cropBatchId: batch.cropBatchId, fieldBlockId: batch.fieldBlockId, label: batch.variety ? `${batch.crop} · ${batch.variety}` : batch.crop })),
    };
  }

  async interpret(ownerId: string, input: { previewId?: string; messages: MessageInput[]; message: string; facts?: MissionFact; responseLanguage?: "id" }) {
    const farmId = await this.farmIdForOwner(ownerId); const previewId = input.previewId ?? randomUUID();
    const messages = [...input.messages, { role: "farmer" as const, content: input.message }];
    const context = await this.repository.context(farmId);
    let interpretation: import("./mission.types").MissionInterpretation;
    try {
      interpretation = await traceAgentOperation("mission-interpretation", () => this.agent.interpret(transcript(messages), interpretationContext(context, messages, input.facts, input.responseLanguage), previewId), { farmId, previewId, thread_id: previewId }, randomUUID())();
    } catch (error) {
      logInterpretationFailure(previewId, error);
      throw interpretationUnavailable(error);
    }
    this.validateFacts(interpretation.facts, context);
    const facts = applyBatchReadiness(interpretation.facts, context.cropBatches);
    const assistant = facts.clarification ? [{ role: "assistant" as const, content: facts.clarification.question }] : [];
    return { previewId, messages: [...messages, ...assistant], facts, review: review(facts), blocks: blocks(facts), manualOptions: this.manualOptions(context) } satisfies MissionCandidate;
  }

  private requireComplete(candidate: MissionCandidate) {
    if (candidate.review.some((item) => item.status !== "confirmed" && !optional.has(item.key))) throw new ApiError(409, "Review every required operational detail before planning");
    for (const key of required) {
      const value = candidate.facts[key];
      if (value === null || value === undefined || (Array.isArray(value) && !value.length)) throw new ApiError(409, `${key} must be clarified before planning`);
    }
  }

  async planPreview(ownerId: string, candidate: MissionCandidate) {
    const farmId = await this.farmIdForOwner(ownerId);
    const context = await this.repository.context(farmId, candidate.facts.fieldBlockId); candidate = this.canonicalCandidate(candidate, context); this.requireComplete(candidate);
    const field = context.fields.find((item) => item.fieldBlockId === candidate.facts.fieldBlockId);
    if (!field) throw new ApiError(409, "Selected field must belong to this farm");
    const missionId = randomUUID();
    const weather = await this.weatherForecast(Number(field.latitude), Number(field.longitude), context.farm.timezone);
    const generated = generateFeasiblePlans({ facts: candidate.facts, dryingProfile: context.farm.dryingProfile as DryingProfile | null, schedulingDurations: context.farm.schedulingDurations, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather });
    if (!generated.plans.length) return { status: "infeasible" as const, missionId, blockers: [generated.infeasibility?.reason ?? "No feasible plan exists for the confirmed constraints."] };
    const identified = generated.plans.map((plan) => ({ ...plan, planId: randomUUID() }));
    let plans: import("./mission.types").GeneratedPlan[];
    let recommendationReasons: Array<{ text: string; evidenceRefs: string[] }>;
    try {
      const ranking = await traceAgentOperation("mission-planning-preview", () => this.agent.rank(identified.map((plan) => ({ candidateId: plan.planId as string, summary: plan.summary, risks: plan.risks, evidence: plan.evidence ?? [], activities: plan.activities })), planningContext(context, candidate), missionId), { farmId, missionId, previewId: candidate.previewId, thread_id: candidate.previewId }, missionId)();
      plans = ranking.map((rank, index) => ({ ...identified.find((plan) => plan.planId === rank.candidateId)!, recommended: index === 0 }));
      recommendationReasons = ranking[0].reasons;
    } catch (error) {
      logPlanningFailure(missionId, error);
      throw planningUnavailable(error);
    }
    const token = signPreview({ farmId, missionId, stateHash: authoritativeStateHash(context, candidate), candidate, plans, traceId: missionId });
    return { status: "feasible" as const, missionId, candidates: plans, recommendation: { planId: plans[0].planId!, reasons: recommendationReasons }, previewToken: token, expiresInSeconds: 1800 };
  }

  async replanPreview(ownerId: string, missionId: string, candidate: MissionCandidate, responseLanguage?: "id", observedRainAt?: string) {
    const farmId = await this.farmIdForOwner(ownerId); const mission = this.requireActive(await this.get(ownerId, missionId));
    const context = await this.repository.context(farmId, candidate.facts.fieldBlockId); candidate = this.canonicalCandidate(candidate, context); this.requireComplete(candidate);
    const field = context.fields.find((item) => item.fieldBlockId === candidate.facts.fieldBlockId);
    if (!field) throw new ApiError(409, "Selected field must belong to this farm");
    const traceId = randomUUID(); const weather = withObservedRain(await this.weatherForecast(Number(field.latitude), Number(field.longitude), context.farm.timezone), observedRainAt);
    const completedSteps = (mission.missionSteps as Array<never>).filter((step: { status?: string }) => step.status === "COMPLETED");
    const generated = generateFeasiblePlans({ facts: candidate.facts, dryingProfile: context.farm.dryingProfile as DryingProfile | null, schedulingDurations: context.farm.schedulingDurations, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather, completedSteps });
    if (!generated.plans.length) return { status: "infeasible" as const, missionId, blockers: [generated.infeasibility?.reason ?? "No feasible replan exists for the confirmed constraints."] };
    const identified = generated.plans.map((plan) => ({ ...plan, planId: randomUUID() }));
    let plans: import("./mission.types").GeneratedPlan[];
    let recommendationReasons: Array<{ text: string; evidenceRefs: string[] }>;
    try {
      const ranking = await traceAgentOperation("mission-replanning-preview", () => this.agent.rank(identified.map((plan) => ({ candidateId: plan.planId as string, summary: plan.summary, risks: plan.risks, evidence: plan.evidence ?? [], activities: plan.activities })), planningContext(context, candidate, responseLanguage), traceId), { farmId, missionId, previewId: candidate.previewId, thread_id: candidate.previewId }, traceId)();
      plans = ranking.map((rank, index) => ({ ...identified.find((plan) => plan.planId === rank.candidateId)!, recommended: index === 0 }));
      recommendationReasons = ranking[0].reasons;
    } catch (error) { logPlanningFailure(missionId, error); throw planningUnavailable(error); }
    const messageCount = Array.isArray(mission.messages) ? mission.messages.length : 0;
    const token = signPreview({ kind: "replan", farmId, missionId, expectedPlanId: typeof mission.approvedPlanId === "string" ? mission.approvedPlanId : null, expectedRevision: Number(mission.revision), messageCount, stateHash: authoritativeStateHash(context, candidate, mission), candidate, plans, observedRainAt, traceId });
    return { status: "feasible" as const, missionId, candidates: plans, recommendation: { planId: plans[0].planId!, reasons: recommendationReasons }, previewToken: token, expiresInSeconds: 1800 };
  }

  async replanFromReport(ownerId: string, missionId: string, report: OperationalReportInput) {
    const candidate = await this.replanDraft(ownerId, missionId);
    if (report.reportType === "RAIN_OR_FIELD_EVENT") {
      const messages = [...candidate.messages, { role: "farmer" as const, content: `Hujan dilaporkan pada ${report.payload.observedAt}. Susun ulang kegiatan yang belum selesai.` }];
      return this.replanPreview(ownerId, missionId, { ...candidate, messages }, "id", report.payload.observedAt);
    }
    if (report.reportType === "WORKER_AVAILABILITY_CHANGED") {
      if (!report.payload.estimatedHarvestMinutes) throw new ApiError(409, "Estimasi durasi panen perlu diklarifikasi sebelum membuat rencana ulang");
      const facts = { ...candidate.facts, workers: report.payload.availableWorkers, harvestDurationMinutes: report.payload.estimatedHarvestMinutes, clarification: null };
      const message = `Ketersediaan pekerja berubah menjadi ${report.payload.availableWorkers} orang. Estimasi durasi panen dari petani: ${report.payload.estimatedHarvestMinutes} menit.`;
      return this.replanPreview(ownerId, missionId, { ...candidate, facts, messages: [...candidate.messages, { role: "farmer", content: message }], review: review(facts), blocks: blocks(facts) }, "id");
    }
    if (report.reportType !== "BUYER_REQUIREMENT_CHANGED") throw new ApiError(409, "This report does not provide enough planning facts for an automatic replan");
    const facts = {
      ...candidate.facts,
      plannedHarvestKg: report.payload.targetQuantityKg,
      ...(report.payload.buyerPickupAt ? { deadlineAt: report.payload.buyerPickupAt } : {}),
      clarification: null,
    };
    const message = `Buyer requirement changed: ${report.payload.targetQuantityKg} kg ${report.payload.quantityBasis.toLowerCase()}${report.payload.buyerPickupAt ? ` with pickup at ${report.payload.buyerPickupAt}` : ""}.`;
    return this.replanPreview(ownerId, missionId, { ...candidate, facts, messages: [...candidate.messages, { role: "farmer", content: message }], review: review(facts), blocks: blocks(facts) }, "id");
  }

  async replanFromInstruction(ownerId: string, missionId: string, instruction?: string) {
    const draft = await this.replanDraft(ownerId, missionId);
    if (!instruction) return this.replanPreview(ownerId, missionId, draft);
    const mission = this.requireActive(await this.get(ownerId, missionId));
    const context = await this.repository.context(await this.farmIdForOwner(ownerId), draft.facts.fieldBlockId);
    let schedule;
    try {
      schedule = await this.agent.interpretScheduleEdit(instruction, {
        currentTime: new Date().toISOString(), timezone: context.farm.timezone,
        steps: (mission.missionSteps as Array<Record<string, unknown>>).filter((step) => step.status === "SCHEDULED").map((step) => ({ missionStepId: step.missionStepId, title: step.title, actionKind: step.actionKind, date: step.startsOn, start: step.windowStart, end: step.windowEnd })),
      }, draft.previewId);
    } catch (error) { logInterpretationFailure(draft.previewId, error); throw interpretationUnavailable(error); }
    if (schedule.question) return { status: "clarification" as const, missionId, question: schedule.question };
    if (schedule.edit) {
      const transformed = applyScheduleEdit({ steps: editableSteps(mission), edit: schedule.edit, workingHours: context.farm.defaultWorkingHours, deadlineAt: draft.facts.deadlineAt!, timezone: context.farm.timezone });
      if ("error" in transformed) return { status: "infeasible" as const, missionId, blockers: [transformed.error] };
      const plan = { ...transformed.plan, planId: randomUUID() };
      const candidate = { ...draft, messages: [...draft.messages, { role: "farmer" as const, content: instruction }] };
      const messageCount = Array.isArray(mission.messages) ? mission.messages.length : 0;
      const previewToken = signPreview({ kind: "replan", farmId: await this.farmIdForOwner(ownerId), missionId, expectedPlanId: typeof mission.approvedPlanId === "string" ? mission.approvedPlanId : null, expectedRevision: Number(mission.revision), messageCount, stateHash: authoritativeStateHash(context, candidate, mission), candidate, plans: [plan], scheduleEdit: schedule.edit, changes: transformed.changes });
      return { status: "feasible" as const, missionId, candidates: [plan], recommendation: { planId: plan.planId, reasons: [{ text: "Perubahan jadwal diterapkan sesuai permintaan dan jam kerja kebun.", evidenceRefs: ["constraint:schedule-edit"] }] }, previewToken, expiresInSeconds: 1800, changes: transformed.changes };
    }
    const candidate = await this.interpretReplan(ownerId, missionId, { previewId: draft.previewId, messages: draft.messages, message: instruction, facts: draft.facts, responseLanguage: "id" });
    if (candidate.facts.clarification) return { status: "clarification" as const, missionId, question: candidate.facts.clarification.question };
    return this.replanPreview(ownerId, missionId, candidate, "id");
  }

  async confirm(ownerId: string, previewToken: string, planId: string) {
    const payload = verifyPreview<{ exp: number; farmId: string; missionId: string; stateHash: string; candidate: MissionCandidate; plans: import("./mission.types").GeneratedPlan[]; traceId?: string }>(previewToken);
    const farmId = await this.farmIdForOwner(ownerId); if (payload.farmId !== farmId) throw new ApiError(409, "Mission preview belongs to another farm");
    const existing = await this.repository.find(farmId, payload.missionId);
    if (existing) return existing;
    this.requireComplete(payload.candidate);
    const context = await this.repository.context(farmId, payload.candidate.facts.fieldBlockId); this.validateFacts(payload.candidate.facts, context);
    const plan = payload.plans.find((item) => item.planId === planId);
    if (!plan) throw new ApiError(409, "Selected plan is not in this preview");
    if (payload.stateHash !== authoritativeStateHash(context, payload.candidate)) throw new ApiError(409, "Farm state changed while you were reviewing plans. Plan again.", "PREVIEW_STALE");
    const field = context.fields.find((item) => item.fieldBlockId === payload.candidate.facts.fieldBlockId)!;
    const weather = await this.weatherForecast(Number(field.latitude), Number(field.longitude), context.farm.timezone);
    if (!validatePlan(plan, { facts: payload.candidate.facts, dryingProfile: context.farm.dryingProfile as DryingProfile | null, schedulingDurations: context.farm.schedulingDurations, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather })) throw new ApiError(409, "The selected plan is no longer feasible with current weather or farm state. Plan again.", "PREVIEW_STALE");
    const original = payload.candidate.messages.find((message) => message.role === "farmer")?.content;
    if (!original) throw new ApiError(409, "Mission preview is missing the original request");
    const mission = await this.repository.createConfirmed({ missionId: payload.missionId, farmId, originalMessage: original, messages: payload.candidate.messages, facts: payload.candidate.facts, blocks: payload.candidate.blocks, plan, workingHours: context.farm.defaultWorkingHours as Prisma.InputJsonValue, weather: weather as Prisma.InputJsonValue, traceId: payload.traceId });
    try { await this.calendarSync.syncIfConnected(farmId); } catch { console.warn("Google Calendar sync failed", { missionId: payload.missionId }); }
    return mission;
  }

  async confirmReplan(ownerId: string, missionId: string, input: { previewToken: string; planId: string; syncCalendar?: boolean }) {
    const payload = verifyPreview<ReplanPreviewPayload>(input.previewToken);
    const farmId = await this.farmIdForOwner(ownerId);
    if (payload.kind !== "replan" || payload.farmId !== farmId || payload.missionId !== missionId) throw new ApiError(409, "Mission preview belongs to another mission");
    this.requireComplete(payload.candidate);
    const mission = this.requireActive(await this.get(ownerId, missionId));
    const context = await this.repository.context(farmId, payload.candidate.facts.fieldBlockId); this.validateFacts(payload.candidate.facts, context);
    const plan = payload.plans.find((item) => item.planId === input.planId);
    if (!plan) throw new ApiError(409, "Selected plan is not in this preview");
    if (payload.stateHash !== authoritativeStateHash(context, payload.candidate, mission)) throw new ApiError(409, "Misi atau kondisi kebun berubah saat usulan ditinjau. Buat rencana ulang lagi.", "PREVIEW_STALE");
    const field = context.fields.find((item) => item.fieldBlockId === payload.candidate.facts.fieldBlockId)!;
    const weather = withObservedRain(await this.weatherForecast(Number(field.latitude), Number(field.longitude), context.farm.timezone), payload.observedRainAt);
    const completedSteps = (mission.missionSteps as Array<never>).filter((step: { status?: string }) => step.status === "COMPLETED");
    if (payload.scheduleEdit) {
      const transformed = applyScheduleEdit({ steps: editableSteps(mission), edit: payload.scheduleEdit, workingHours: context.farm.defaultWorkingHours, deadlineAt: payload.candidate.facts.deadlineAt!, timezone: context.farm.timezone });
      if ("error" in transformed || JSON.stringify(canonical(transformed.plan.activities)) !== JSON.stringify(canonical(plan.activities))) throw new ApiError(409, "Jadwal berubah saat usulan ditinjau. Buat rencana ulang lagi.", "PREVIEW_STALE");
    } else if (!validatePlan(plan, { facts: payload.candidate.facts, dryingProfile: context.farm.dryingProfile as DryingProfile | null, schedulingDurations: context.farm.schedulingDurations, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather, completedSteps })) throw new ApiError(409, "The selected plan is no longer feasible with current weather or mission state. Plan again.", "PREVIEW_STALE");
    try {
      const mission = await this.repository.replaceConfirmedPlan({ missionId, farmId, expectedPlanId: payload.expectedPlanId, expectedRevision: payload.expectedRevision, messages: payload.candidate.messages.slice(payload.messageCount), facts: payload.candidate.facts, blocks: payload.candidate.blocks.filter((block) => block.value !== null && block.value !== undefined), plan, workingHours: context.farm.defaultWorkingHours as Prisma.InputJsonValue, weather: weather as Prisma.InputJsonValue, traceId: payload.traceId });
      try {
        if (input.syncCalendar === false) return { mission, calendarSync: { status: "PENDING" as const } };
        const result = await this.calendarSync.syncIfConnected(farmId);
        return { mission, calendarSync: result === null ? { status: "NOT_CONNECTED" as const } : result.failed ? { status: result.synced ? "PARTIAL" as const : "FAILED" as const, ...result } : { status: "SYNCED" as const, ...result } };
      } catch {
        console.warn("Google Calendar sync failed", { missionId });
        return { mission, calendarSync: { status: "FAILED" as const, synced: 0, failed: 1 } };
      }
    } catch (error) {
      if (error instanceof Error && error.message === "stale-mission") throw new ApiError(409, "Misi berubah saat usulan ditinjau. Buat rencana ulang lagi.", "PREVIEW_STALE");
      if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientValidationError) {
        console.warn("Mission replan persistence failed", { missionId, kind: error.name, code: "code" in error ? error.code : undefined });
        throw new ApiError(503, "Rencana belum dapat disimpan. Coba setujui kembali dalam beberapa saat.");
      }
      throw error;
    }
  }

  async advance(ownerId: string, missionId: string, stage: string) {
    const mission = await this.get(ownerId, missionId); const expected = nextMissionStage(mission.stage as string);
    if (mission.status !== "ACTIVE") throw new ApiError(409, "Mission is no longer in active execution");
    if (expected !== stage) throw new ApiError(409, "Mission stage cannot advance to that state");
    const steps = mission.missionSteps as StoredStep[];
    if (!canAdvanceMissionStage(mission.stage as string, steps)) throw new ApiError(409, "Complete the current mission steps before advancing");
    const changed = await this.repository.advance(await this.farmIdForOwner(ownerId), missionId, mission.stage as string, stage, stage === "TO_REVIEW" ? "CLOSEOUT" : "ACTIVE");
    if (!changed) throw new ApiError(409, "Mission stage changed; refresh and retry");
    return changed;
  }

  async updateStepStatus(ownerId: string, missionId: string, stepId: string, status: MissionStepStatus) {
    const mission = await this.get(ownerId, missionId);
    if (mission.status !== "ACTIVE" || !["HARVESTING", "DRYING"].includes(mission.stage as string)) throw new ApiError(409, "Mission is not in an executable stage");
    const steps = mission.missionSteps as StoredStep[];
    const step = steps.find((item) => item.missionStepId === stepId);
    if (!step) throw new ApiError(404, "Mission step not found");
    if ((step as StoredStep & { actionKind?: string }).actionKind === "CONFIRM_DRYING_COMPLETE") throw new ApiError(409, "Drying completion requires a farmer-confirmed inspection checklist");
    if (step.stage !== mission.stage) throw new ApiError(409, "Mission step is not in the current stage");
    if (!isStepTransitionAllowed(step, status, steps)) throw new ApiError(409, "Mission step cannot advance to that state");
    if (step.status === status) return mission;
    const changed = await this.repository.updateStepStatus(await this.farmIdForOwner(ownerId), missionId, stepId, step.status, status);
    if (!changed) throw new ApiError(409, "Mission step changed; refresh and retry");
    return changed;
  }

  async closeout(ownerId: string, missionId: string, values: MissionCloseoutInput) {
    const farmId = await this.farmIdForOwner(ownerId); const mission = await this.get(ownerId, missionId);
    if (mission.status === "COMPLETED") return mission;
    if (mission.status !== "CLOSEOUT" || mission.stage !== "TO_REVIEW") throw new ApiError(409, "Mission must be ready for closeout review");
    if (mission.closeout) return mission;
    const constraints = mission.constraints as MissionRecord[];
    const plannedHarvestKg = constraints.find((item) => item.key === "plannedHarvestKg")?.value;
    if (typeof plannedHarvestKg !== "number") throw new ApiError(409, "Mission is missing its planned harvest amount");
    const result = await this.repository.recordCloseout(farmId, missionId, { ...values, plannedHarvestKg, plannedDriedKg: plannedHarvestKg });
    if (!result) throw new ApiError(409, "Mission is no longer ready for closeout");
    return result;
  }

  async confirmCloseout(ownerId: string, missionId: string) {
    const farmId = await this.farmIdForOwner(ownerId); const mission = await this.get(ownerId, missionId);
    if (mission.status === "COMPLETED") return mission;
    if (mission.status !== "CLOSEOUT" || mission.stage !== "TO_REVIEW" || !mission.closeout) throw new ApiError(409, "Record and review the closeout summary before confirming");
    const result = await this.repository.confirmCloseout(farmId, missionId);
    if (!result) throw new ApiError(409, "Mission closeout changed; refresh and retry");
    return result;
  }
}
