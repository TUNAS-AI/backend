import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { traceAgentOperation } from "../../agent/tracing";
import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { MissionAgent, MissionInterpretationOutputError, normalizeMissionDeadline } from "../../agent/missions/mission-agent";
import { getOpenMeteoForecast } from "../../agent/missions/open-meteo.client";
import { signPreview, verifyPreview } from "./mission-preview-token";
import { MissionRepository } from "./mission.repository";
import { GoogleCalendarService } from "../google-calendar/google-calendar.service";
import { generateFeasiblePlans, validatePlan } from "./deterministic-planner";
import type { FactBlock, MessageInput, MissionCandidate, MissionCloseoutInput, MissionFact, MissionRecord, MissionStage, MissionStatus, MissionStepStatus } from "./mission.types";
import type { OperationalReportInput } from "../tunas/operational-report";

const stages: Record<Exclude<MissionStage, "COMPLETED">, Exclude<MissionStage, "WAITING" | "COMPLETED"> | undefined> = { WAITING: "HARVESTING", HARVESTING: "DRYING", DRYING: "FINISHED", FINISHED: "TO_REVIEW", TO_REVIEW: undefined };
export const nextMissionStage = (stage: string) => stages[stage as keyof typeof stages];
export function missionVersionTimestamp(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new ApiError(409, "Mission version timestamp is invalid");
  return date.toISOString();
}
type StoredStep = { missionStepId: string; sequence: number; stage: "HARVESTING" | "DRYING"; status: MissionStepStatus };
type ReplanPreviewPayload = { exp: number; kind: "replan"; farmId: string; missionId: string; expectedPlanId: string | null; expectedUpdatedAt: string; messageCount: number; stateHash: string; candidate: MissionCandidate; plans: import("./mission.types").GeneratedPlan[]; observedRainAt?: string; traceId?: string };

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
const required = ["fieldBlockId", "cropBatchIds", "marketQuality", "plannedHarvestKg", "plannedDriedKg", "deadline", "harvestDurationHours", "rainProtectionAvailable"] as const;
const factKeys = ["fieldBlock", "cropBatch", "marketQuality", "deadline", "plannedHarvestKg", "plannedDriedKg"] as const;
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
  const state = { farm: { timezone: context.farm.timezone, defaultWorkingHours: context.farm.defaultWorkingHours }, field, batches, facts: candidate.facts, mission: mission ? { approvedPlanId: mission.approvedPlanId, updatedAt: mission.updatedAt, stage: mission.stage, steps: mission.missionSteps } : null };
  return createHash("sha256").update(JSON.stringify(canonical(state))).digest("hex");
}
function interpretationContext(context: Awaited<ReturnType<MissionRepository["context"]>>, messages: MessageInput[], existingFacts?: MissionFact, responseLanguage?: "id") {
  return {
    farmer: { displayName: context.farm.owner.displayName, locale: context.farm.owner.locale, timezone: context.farm.owner.timezone },
    farm: { name: context.farm.name, location: context.farm.location, notes: context.farm.notes, timezone: context.farm.timezone, defaultWorkingHours: context.farm.defaultWorkingHours, defaultWorkerCount: context.farm.defaultWorkerCount },
    fields: context.fields.map((field) => ({ fieldBlockId: field.fieldBlockId, name: field.name, areaHectares: field.areaHectares, latitude: field.latitude, longitude: field.longitude, status: field.status, notes: field.notes })),
    cropBatches: context.cropBatches.map((batch) => ({ cropBatchId: batch.cropBatchId, fieldBlockId: batch.fieldBlockId, crop: batch.crop, variety: batch.variety, plantingDate: batch.plantingDate, status: batch.status, notes: batch.notes })),
    completedMissionHistory: context.history.map((outcome) => ({ fieldBlockId: outcome.mission.fieldBlockId, originalMessage: outcome.mission.originalMessage, plannedHarvestKg: outcome.plannedHarvestKg, plannedDriedKg: outcome.plannedDriedKg, actualHarvestKg: outcome.actualHarvestKg, actualDriedKg: outcome.actualDriedKg, notes: outcome.notes, summary: outcome.summary })),
    conversation: messages,
    existingFacts: existingFacts ?? null,
    responseLanguage: responseLanguage ?? null,
  };
}
function confidence(value: unknown): "low" | "high" { return value === null || value === "" || (Array.isArray(value) && !value.length) ? "low" : "high"; }
function review(facts: MissionFact) {
    const keys = ["fieldBlockId", "cropBatchIds", "marketQuality", "plannedHarvestKg", "plannedDriedKg", "deadline", "harvestDurationHours", "estimatedHarvestableKg", "rainProtectionAvailable", "availableWorkerCount", "coveredDryingCapacityKg", "notes"] as const;
  return keys.map((key) => ({ key, status: confidence(facts[key]) === "high" ? "confirmed" as const : "missing" as const, reason: confidence(facts[key]) === "high" ? "Ready for planning." : required.includes(key as typeof required[number]) ? "This detail is needed before planning." : "Optional; add it if it affects the work.", provenance: "FARMER_REPORTED" as const, confidence: confidence(facts[key]) }));
}
function blocks(facts: MissionFact): FactBlock[] {
  return [
    { key: "fieldBlock", value: facts.fieldBlockId, provenance: "INFERRED", confidence: confidence(facts.fieldBlockId) },
    { key: "cropBatch", value: facts.cropBatchIds, provenance: "INFERRED", confidence: confidence(facts.cropBatchIds) },
    { key: "marketQuality", value: facts.marketQuality, provenance: "FARMER_REPORTED", confidence: confidence(facts.marketQuality) },
    { key: "deadline", value: facts.deadline, provenance: "FARMER_REPORTED", confidence: confidence(facts.deadline) },
    { key: "plannedHarvestKg", value: facts.plannedHarvestKg, provenance: "FARMER_REPORTED", confidence: confidence(facts.plannedHarvestKg) },
    { key: "plannedDriedKg", value: facts.plannedDriedKg, provenance: "FARMER_REPORTED", confidence: confidence(facts.plannedDriedKg) },
    { key: "harvestDurationHours", value: facts.harvestDurationHours, provenance: "FARMER_REPORTED", confidence: confidence(facts.harvestDurationHours) },
    { key: "estimatedHarvestableKg", value: facts.estimatedHarvestableKg, provenance: "FARMER_REPORTED", confidence: confidence(facts.estimatedHarvestableKg) },
    { key: "rainProtectionAvailable", value: facts.rainProtectionAvailable, provenance: "FARMER_REPORTED", confidence: facts.rainProtectionAvailable === null ? "low" : "high" },
    { key: "availableWorkerCount", value: facts.availableWorkerCount, provenance: "FARMER_REPORTED", confidence: confidence(facts.availableWorkerCount) },
    { key: "coveredDryingCapacityKg", value: facts.coveredDryingCapacityKg, provenance: "FARMER_REPORTED", confidence: confidence(facts.coveredDryingCapacityKg) },
  ];
}

export class MissionService {
  constructor(private readonly repository = new MissionRepository(), private readonly agent = new MissionAgent(), private readonly farmIdForOwner: (ownerId: string) => Promise<string> = callerFarmId, private readonly weatherForecast = getOpenMeteoForecast, private readonly calendarSync = new GoogleCalendarService()) {}

  async list(ownerId: string) { return this.repository.list(await this.farmIdForOwner(ownerId)); }
  async current(ownerId: string) { return this.repository.current(await this.farmIdForOwner(ownerId)); }
  async calendar(ownerId: string, range: { from: Date; to: Date }) { return this.repository.calendar(await this.farmIdForOwner(ownerId), range.from, range.to); }
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
    const marketQuality = value("marketQuality"); const plannedHarvestKg = value("plannedHarvestKg"); const plannedDriedKg = value("plannedDriedKg"); const deadline = value("deadline"); const availableWorkerCount = value("availableWorkerCount"); const coveredDryingCapacityKg = value("coveredDryingCapacityKg");
    return {
      fieldBlockId: typeof mission.fieldBlockId === "string" ? mission.fieldBlockId : null,
      cropBatchIds: cropBatches.map((item) => item.cropBatchId),
      marketQuality: marketQuality === "Grade A" || marketQuality === "Grade B" || marketQuality === "Grade C" ? marketQuality : null,
      plannedHarvestKg: typeof plannedHarvestKg === "number" ? plannedHarvestKg : null,
      plannedDriedKg: typeof plannedDriedKg === "number" ? plannedDriedKg : null,
      deadline: typeof deadline === "string" ? deadline : null,
      harvestDurationHours: typeof value("harvestDurationHours") === "number" ? value("harvestDurationHours") as number : null,
      estimatedHarvestableKg: typeof value("estimatedHarvestableKg") === "number" ? value("estimatedHarvestableKg") as number : null,
      rainProtectionAvailable: typeof value("rainProtectionAvailable") === "boolean" ? value("rainProtectionAvailable") as boolean : null,
      availableWorkerCount: typeof availableWorkerCount === "number" ? availableWorkerCount : null,
      coveredDryingCapacityKg: typeof coveredDryingCapacityKg === "number" ? coveredDryingCapacityKg : null,
      notes: typeof mission.notes === "string" ? mission.notes : null,
      clarification: null,
    };
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
    const deadline = normalizeMissionDeadline(candidate.facts.deadline, context.farm.timezone);
    if (candidate.facts.deadline && !deadline) throw new ApiError(409, "Deadline must be a calendar date or ISO timestamp");
    const facts = { ...candidate.facts, deadline, clarification: null };
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
    const assistant = interpretation.facts.clarification ? [{ role: "assistant" as const, content: interpretation.facts.clarification.question }] : [];
    return { previewId, messages: [...messages, ...assistant], facts: interpretation.facts, review: interpretation.review, blocks: blocks(interpretation.facts), manualOptions: this.manualOptions(context) } satisfies MissionCandidate;
  }

  private requireComplete(candidate: MissionCandidate) {
    if (candidate.review.some((item) => item.status !== "confirmed" && !["notes", "estimatedHarvestableKg", "availableWorkerCount", "coveredDryingCapacityKg"].includes(item.key))) throw new ApiError(409, "Review every required mission detail before planning");
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
    const generated = generateFeasiblePlans({ facts: candidate.facts, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather });
    if (!generated.plans.length) return { status: "infeasible" as const, missionId, blockers: [generated.infeasibility?.reason ?? "No feasible plan exists for the confirmed constraints."] };
    const identified = generated.plans.map((plan) => ({ ...plan, planId: randomUUID() }));
    let plans: import("./mission.types").GeneratedPlan[];
    let recommendationReason: string;
    try {
      const ranking = await traceAgentOperation("mission-planning-preview", () => this.agent.rank(identified.map((plan) => ({ candidateId: plan.planId as string, summary: plan.summary, risks: plan.risks })), planningContext(context, candidate), missionId), { farmId, missionId, previewId: candidate.previewId, thread_id: candidate.previewId }, missionId)();
      plans = ranking.map((rank, index) => ({ ...identified.find((plan) => plan.planId === rank.candidateId)!, recommended: index === 0 }));
      recommendationReason = ranking[0].reason;
    } catch (error) {
      logPlanningFailure(missionId, error);
      throw planningUnavailable(error);
    }
    const token = signPreview({ farmId, missionId, stateHash: authoritativeStateHash(context, candidate), candidate, plans, traceId: missionId });
    return { status: "feasible" as const, missionId, candidates: plans, recommendation: { planId: plans[0].planId!, reasons: [recommendationReason] }, previewToken: token, expiresInSeconds: 1800 };
  }

  async replanPreview(ownerId: string, missionId: string, candidate: MissionCandidate, responseLanguage?: "id", observedRainAt?: string) {
    const farmId = await this.farmIdForOwner(ownerId); const mission = this.requireActive(await this.get(ownerId, missionId));
    const context = await this.repository.context(farmId, candidate.facts.fieldBlockId); candidate = this.canonicalCandidate(candidate, context); this.requireComplete(candidate);
    const field = context.fields.find((item) => item.fieldBlockId === candidate.facts.fieldBlockId);
    if (!field) throw new ApiError(409, "Selected field must belong to this farm");
    const traceId = randomUUID(); const weather = withObservedRain(await this.weatherForecast(Number(field.latitude), Number(field.longitude), context.farm.timezone), observedRainAt);
    const completedSteps = (mission.missionSteps as Array<never>).filter((step: { status?: string }) => step.status === "COMPLETED");
    const generated = generateFeasiblePlans({ facts: candidate.facts, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather, completedSteps });
    if (!generated.plans.length) return { status: "infeasible" as const, missionId, blockers: [generated.infeasibility?.reason ?? "No feasible replan exists for the confirmed constraints."] };
    const identified = generated.plans.map((plan) => ({ ...plan, planId: randomUUID() }));
    let plans: import("./mission.types").GeneratedPlan[];
    let recommendationReason: string;
    try {
      const ranking = await traceAgentOperation("mission-replanning-preview", () => this.agent.rank(identified.map((plan) => ({ candidateId: plan.planId as string, summary: plan.summary, risks: plan.risks })), planningContext(context, candidate, responseLanguage), traceId), { farmId, missionId, previewId: candidate.previewId, thread_id: candidate.previewId }, traceId)();
      plans = ranking.map((rank, index) => ({ ...identified.find((plan) => plan.planId === rank.candidateId)!, recommended: index === 0 }));
      recommendationReason = ranking[0].reason;
    } catch (error) { logPlanningFailure(missionId, error); throw planningUnavailable(error); }
    const messageCount = Array.isArray(mission.messages) ? mission.messages.length : 0;
    const token = signPreview({ kind: "replan", farmId, missionId, expectedPlanId: typeof mission.approvedPlanId === "string" ? mission.approvedPlanId : null, expectedUpdatedAt: missionVersionTimestamp(mission.updatedAt), messageCount, stateHash: authoritativeStateHash(context, candidate, mission), candidate, plans, observedRainAt, traceId });
    return { status: "feasible" as const, missionId, candidates: plans, recommendation: { planId: plans[0].planId!, reasons: [recommendationReason] }, previewToken: token, expiresInSeconds: 1800 };
  }

  async replanFromReport(ownerId: string, missionId: string, report: OperationalReportInput) {
    const candidate = await this.replanDraft(ownerId, missionId);
    if (report.reportType === "RAIN_OR_FIELD_EVENT") {
      const messages = [...candidate.messages, { role: "farmer" as const, content: `Hujan dilaporkan pada ${report.payload.observedAt}. Susun ulang kegiatan yang belum selesai.` }];
      return this.replanPreview(ownerId, missionId, { ...candidate, messages }, "id", report.payload.observedAt);
    }
    if (report.reportType !== "BUYER_REQUIREMENT_CHANGED") throw new ApiError(409, "This report does not provide enough planning facts for an automatic replan");
    const facts = {
      ...candidate.facts,
      ...(report.payload.quantityBasis === "HARVESTED" ? { plannedHarvestKg: report.payload.targetQuantityKg } : { plannedDriedKg: report.payload.targetQuantityKg }),
      ...(report.payload.deadline ? { deadline: report.payload.deadline } : {}),
      clarification: null,
    };
    const message = `Buyer requirement changed: ${report.payload.targetQuantityKg} kg ${report.payload.quantityBasis.toLowerCase()}${report.payload.deadline ? ` by ${report.payload.deadline}` : ""}.`;
    return this.replanPreview(ownerId, missionId, { ...candidate, facts, messages: [...candidate.messages, { role: "farmer", content: message }], review: review(facts), blocks: blocks(facts) }, "id");
  }

  async replanFromInstruction(ownerId: string, missionId: string, instruction?: string) {
    const draft = await this.replanDraft(ownerId, missionId);
    if (!instruction) return this.replanPreview(ownerId, missionId, draft);
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
    if (!validatePlan(plan, { facts: payload.candidate.facts, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather })) throw new ApiError(409, "The selected plan is no longer feasible with current weather or farm state. Plan again.", "PREVIEW_STALE");
    const original = payload.candidate.messages.find((message) => message.role === "farmer")?.content;
    if (!original) throw new ApiError(409, "Mission preview is missing the original request");
    const mission = await this.repository.createConfirmed({ missionId: payload.missionId, farmId, originalMessage: original, messages: payload.candidate.messages, facts: payload.candidate.facts, blocks: payload.candidate.blocks, plan, weather: weather as Prisma.InputJsonValue, traceId: payload.traceId });
    try { await this.calendarSync.syncIfConnected(farmId); } catch { console.warn("Google Calendar sync failed", { missionId: payload.missionId }); }
    return mission;
  }

  async confirmReplan(ownerId: string, missionId: string, input: { previewToken: string; planId: string }) {
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
    if (!validatePlan(plan, { facts: payload.candidate.facts, timezone: context.farm.timezone, workingHours: context.farm.defaultWorkingHours, weather, completedSteps })) throw new ApiError(409, "The selected plan is no longer feasible with current weather or mission state. Plan again.", "PREVIEW_STALE");
    try {
      const mission = await this.repository.replaceConfirmedPlan({ missionId, farmId, expectedPlanId: payload.expectedPlanId, expectedUpdatedAt: new Date(payload.expectedUpdatedAt), messages: payload.candidate.messages.slice(payload.messageCount), facts: payload.candidate.facts, blocks: payload.candidate.blocks, plan, weather: weather as Prisma.InputJsonValue, traceId: payload.traceId });
      try { await this.calendarSync.syncIfConnected(farmId); } catch { console.warn("Google Calendar sync failed", { missionId }); }
      return mission;
    } catch (error) {
      if (error instanceof Error && error.message === "stale-mission") throw new ApiError(409, "Misi berubah saat usulan ditinjau. Buat rencana ulang lagi.", "PREVIEW_STALE");
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
    const plannedDriedKg = constraints.find((item) => item.key === "plannedDriedKg")?.value;
    if (typeof plannedHarvestKg !== "number" || typeof plannedDriedKg !== "number") throw new ApiError(409, "Mission is missing planned closeout metrics");
    const result = await this.repository.recordCloseout(farmId, missionId, { ...values, plannedHarvestKg, plannedDriedKg });
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
