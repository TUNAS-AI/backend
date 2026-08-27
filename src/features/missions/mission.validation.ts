import { z } from "zod";
import { ApiError } from "../../shared/api-error";
import { input, number, text, uuid } from "../../shared/input-validation";
import type { MessageInput, MissionCandidate, MissionStepStatus } from "./mission.types";

const messageSchema = z.object({ role: z.enum(["farmer", "assistant"]), content: z.string().trim().min(1).max(4000) });
const factsSchema = z.object({
  fieldBlockId: z.string().uuid().nullable(), cropBatchIds: z.array(z.string().uuid()).max(12), buyerCommitmentId: z.string().uuid().nullable(),
  maturity: z.string().min(1).nullable(), buyerQuantityKg: z.number().positive().nullable(), marketQuality: z.string().min(1).nullable(), plannedHarvestKg: z.number().positive().nullable(), plannedDriedKg: z.number().positive().nullable(), deadline: z.union([z.string().datetime(), z.string().date()]).nullable(), availableWorkerCount: z.number().int().positive().nullable(), coveredDryingCapacityKg: z.number().positive().nullable(), notes: z.string().min(1).nullable(), clarification: z.object({ key: z.string().min(1), question: z.string().min(1) }).nullable(),
});
const reviewSchema = z.object({ key: z.enum(["fieldBlockId", "cropBatchIds", "buyerCommitmentId", "maturity", "buyerQuantityKg", "marketQuality", "plannedHarvestKg", "plannedDriedKg", "deadline", "availableWorkerCount", "coveredDryingCapacityKg", "notes"]), status: z.enum(["confirmed", "needs_clarification", "missing"]), reason: z.string().min(1), provenance: z.enum(["FARMER_REPORTED", "INFERRED"]), confidence: z.enum(["high", "medium", "low"]) });
const candidateSchema = z.object({ previewId: z.string().uuid(), messages: z.array(messageSchema).min(1).max(40), facts: factsSchema }).transform((candidate) => ({ ...candidate, review: [], blocks: [] }) as MissionCandidate);

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, `${label} is invalid`);
  return result.data;
}

export function parsePreviewInterpret(value: unknown) {
  const body = input(value);
  const messages = body.messages === undefined ? [] : parseSchema(z.array(messageSchema).max(39), body.messages, "messages");
  return { previewId: body.previewId === undefined ? undefined : uuid(body.previewId, "previewId"), messages: messages as MessageInput[], message: text(body.message, "message"), facts: body.facts === undefined ? undefined : parseSchema(factsSchema, body.facts, "facts") };
}
export function parsePreviewCandidate(value: unknown): MissionCandidate { return parseSchema(candidateSchema, input(value).candidate, "candidate"); }
export function parseConfirmation(value: unknown) { const body = input(value); return { previewToken: text(body.previewToken, "previewToken"), planId: uuid(body.planId, "planId") }; }
export function parseStage(value: unknown) { const stage = text(input(value).stage, "stage"); if (!["HARVESTING", "DRYING", "FINISHED", "TO_REVIEW"].includes(stage)) throw new ApiError(400, "stage is invalid"); return stage; }
export function parseStepStatus(value: unknown): MissionStepStatus { const status = text(input(value).status, "status"); if (!["IN_PROGRESS", "COMPLETED"].includes(status)) throw new ApiError(400, "status is invalid"); return status as MissionStepStatus; }
export function parseCloseout(value: unknown) { const body = input(value); return { actualHarvestKg: number(body.actualHarvestKg, "actualHarvestKg", 0), actualDriedKg: number(body.actualDriedKg, "actualDriedKg", 0), notes: body.notes === undefined ? null : text(body.notes, "notes") }; }
export function parseMissionId(value: unknown, key: string) { return uuid(value, key); }
