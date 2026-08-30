import { z } from "zod";

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const base = { observedAt: isoDateTime, missionStepId: z.uuid().optional(), fieldBlockId: z.uuid().optional(), cropBatchId: z.uuid().optional(), narrative: z.string().trim().min(1).max(4000).optional(), supersedesReportId: z.uuid().optional() };

export const operationalReportSchema = z.discriminatedUnion("reportType", [
  z.object({ ...base, reportType: z.literal("ACTIVITY_STARTED"), missionStepId: z.uuid(), payload: z.object({ missionStepId: z.uuid() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("ACTIVITY_COMPLETED"), missionStepId: z.uuid(), payload: z.object({ missionStepId: z.uuid() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("ACTUAL_QUANTITY_REPORTED"), payload: z.object({ quantityKg: z.number().finite().nonnegative(), quantityBasis: z.enum(["HARVESTED", "DRIED"]), cumulative: z.boolean() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("WORKER_AVAILABILITY_CHANGED"), payload: z.object({ availableWorkers: z.number().int().nonnegative(), effectiveAt: isoDateTime.optional(), estimatedHarvestMinutes: z.number().int().positive().optional() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("BUYER_REQUIREMENT_CHANGED"), payload: z.object({ targetQuantityKg: z.number().finite().nonnegative(), quantityBasis: z.enum(["HARVESTED", "DRIED"]), buyerPickupAt: z.string().datetime().optional() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("DRYING_RESOURCE_CHANGED"), payload: z.object({ available: z.boolean(), protectionAvailable: z.boolean().optional() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("DRYING_INSPECTION"), missionStepId: z.uuid(), payload: z.object({ missionStepId: z.uuid(), neckDry: z.boolean(), topsDry: z.boolean(), outerScalesDry: z.boolean(), noWetPockets: z.boolean(), noActiveDecay: z.boolean(), decision: z.enum(["INCOMPLETE", "COMPLETE", "UNSAFE"]), nextInspectionAt: isoDateTime.optional() }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("RAIN_OR_FIELD_EVENT"), payload: z.object({ event: z.string().trim().min(1).max(1000), observedAt: isoDateTime }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("MISSION_DEVIATION"), payload: z.object({ description: z.string().trim().min(1).max(2000) }).strict() }).strict(),
  z.object({ ...base, reportType: z.literal("GENERAL_OPERATIONAL_NOTE"), payload: z.object({ text: z.string().trim().min(1).max(4000) }).strict() }).strict(),
]).superRefine((report, context) => {
  if ((report.reportType === "ACTIVITY_STARTED" || report.reportType === "ACTIVITY_COMPLETED") && report.missionStepId !== report.payload.missionStepId) context.addIssue({ code: "custom", message: "missionStepId must match payload.missionStepId" });
  if (report.reportType === "DRYING_INSPECTION" && report.missionStepId !== report.payload.missionStepId) context.addIssue({ code: "custom", message: "missionStepId must match payload.missionStepId" });
  if (report.reportType === "DRYING_INSPECTION" && report.payload.decision === "COMPLETE" && ![report.payload.neckDry, report.payload.topsDry, report.payload.outerScalesDry, report.payload.noWetPockets, report.payload.noActiveDecay].every(Boolean)) context.addIssue({ code: "custom", message: "Every drying completion observation must be confirmed" });
  if (report.reportType === "DRYING_INSPECTION" && report.payload.decision === "INCOMPLETE" && !report.payload.nextInspectionAt) context.addIssue({ code: "custom", message: "Incomplete drying requires the next inspection time" });
});

export type OperationalReportInput = z.infer<typeof operationalReportSchema>;
export type OperationalImpact = { level: "NONE" | "MATERIAL"; reasons: string[]; replanSupported: boolean };
export const parseOperationalReport = (value: unknown): OperationalReportInput => operationalReportSchema.parse(value);
