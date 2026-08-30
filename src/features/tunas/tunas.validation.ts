import { input, text, uuid } from "../../shared/input-validation";
import { ApiError } from "../../shared/api-error";
import { operationalReportSchema } from "./operational-report";

export function parseMessageId(value: unknown) { return uuid(value, "messageId"); }
export function parseAction(value: unknown) {
  const action = text(input(value).action, "action");
  if (!['keep', 'reschedule', 'regenerate'].includes(action)) throw new ApiError(400, "action is invalid");
  return action as "keep" | "reschedule" | "regenerate";
}
export function parseMissionBody(value: unknown) { return uuid(input(value).missionId, "missionId"); }
export function parseScenario(value: unknown) {
  const scenario = text(value, "scenario");
  if (!['drying-rain', 'harvest-rain', 'irregular-rain'].includes(scenario)) throw new ApiError(400, "scenario is invalid");
  return scenario as "drying-rain" | "harvest-rain" | "irregular-rain";
}

export function parseInteraction(value: unknown, idempotencyKey: unknown) {
  const body = input(value);
  if ((body.message === undefined) === (body.report === undefined)) throw new ApiError(400, "Provide exactly one of message or report");
  const message = body.message === undefined ? "Structured operational report" : text(body.message, "message");
  if (message.length > 4000) throw new ApiError(400, "message is too long");
  const missionId = body.missionId === undefined || body.missionId === null ? null : uuid(body.missionId, "missionId");
  if (body.report !== undefined && !missionId) throw new ApiError(400, "missionId is required for a structured report");
  const channel = body.channel === undefined ? "web" : text(body.channel, "channel");
  if (!/^[a-z0-9_-]{1,40}$/i.test(channel)) throw new ApiError(400, "channel is invalid");
  const identity = body.externalMessageId ?? idempotencyKey;
  const externalMessageId = text(identity, "externalMessageId or Idempotency-Key");
  if (externalMessageId.length > 200) throw new ApiError(400, "externalMessageId is too long");
  const parsed = body.report === undefined ? undefined : operationalReportSchema.safeParse(body.report);
  if (parsed && !parsed.success) throw new ApiError(400, `report is invalid: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  return { message, report: parsed?.data, missionId, channel, externalMessageId };
}

export function parsePendingActionId(value: unknown) { return uuid(value, "pendingActionId"); }
