import { input, text, uuid } from "../../shared/input-validation";
import { ApiError } from "../../shared/api-error";

export function parseMessageId(value: unknown) { return uuid(value, "messageId"); }
export function parseAction(value: unknown) {
  const action = text(input(value).action, "action");
  if (!['keep', 'reschedule', 'regenerate'].includes(action)) throw new ApiError(400, "action is invalid");
  return action as "keep" | "reschedule" | "regenerate";
}
export function parseScenario(value: unknown) {
  const scenario = text(value, "scenario");
  if (!['drying-rain', 'harvest-rain', 'irregular-rain'].includes(scenario)) throw new ApiError(400, "scenario is invalid");
  return scenario as "drying-rain" | "harvest-rain" | "irregular-rain";
}
