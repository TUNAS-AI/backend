import { ApiError } from "./api-error";

export type Input = Record<string, unknown>;
export const has = (value: Input, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function input(value: unknown): Input {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError(400, "Request body must be a JSON object");
  return value as Input;
}

export function text(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${key} must be a non-empty string`);
  return value.trim();
}

export function nullableText(value: unknown, key: string): string | null { return value === null ? null : text(value, key); }

export function number(value: unknown, key: string, minimum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
    throw new ApiError(400, `${key} must be ${integer ? "an integer" : "a number"} greater than or equal to ${minimum}`);
  }
  return value;
}

export function uuid(value: unknown, key: string): string {
  const parsed = text(value, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) throw new ApiError(400, `${key} must be a UUID`);
  return parsed;
}

export function date(value: unknown, key: string): Date {
  const parsed = text(value, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) throw new ApiError(400, `${key} must be an ISO date`);
  const result = new Date(`${parsed}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime())) throw new ApiError(400, `${key} must be an ISO date`);
  return result;
}

export function timestamp(value: unknown, key: string): Date {
  const result = new Date(text(value, key));
  if (Number.isNaN(result.getTime())) throw new ApiError(400, `${key} must be an ISO timestamp`);
  return result;
}
