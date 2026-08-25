import { ApiError } from "../../shared/api-error";
import { has, input, nullableText, number, text, type Input } from "../../shared/input-validation";
import type { FarmInput } from "./farm.types";

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function workingHours(value: unknown): Input | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError(400, "defaultWorkingHours must be a JSON object");
  const result: Input = {};
  for (const [day, ranges] of Object.entries(value)) {
    if (!weekdays.includes(day as (typeof weekdays)[number]) || !Array.isArray(ranges)) throw new ApiError(400, `defaultWorkingHours.${day} must be a weekday array`);
    const parsedRanges = ranges.map((range, index) => {
      if (typeof range !== "object" || range === null || Array.isArray(range)) throw new ApiError(400, `defaultWorkingHours.${day}[${index}] must be a JSON object`);
      const start = text((range as Input).start, `defaultWorkingHours.${day}[${index}].start`);
      const end = text((range as Input).end, `defaultWorkingHours.${day}[${index}].end`);
      if (!timePattern.test(start) || !timePattern.test(end) || end <= start) throw new ApiError(400, `defaultWorkingHours.${day}[${index}] must be an increasing HH:MM range`);
      return { start, end };
    });
    const ordered = [...parsedRanges].sort((left, right) => left.start.localeCompare(right.start));
    if (ordered.some((range, index) => index > 0 && range.start < ordered[index - 1].end)) {
      throw new ApiError(400, `defaultWorkingHours.${day} ranges must not overlap`);
    }
    result[day] = parsedRanges;
  }
  return result;
}

export function parseFarm(value: unknown, create: boolean): FarmInput {
  const source = input(value); const result: FarmInput = {};
  if (create) { result.name = text(source.name, "name"); result.defaultWorkerCount = number(source.defaultWorkerCount, "defaultWorkerCount", 1, true); }
  else if (has(source, "name")) result.name = text(source.name, "name");
  for (const key of ["location", "notes"] as const) if (has(source, key)) result[key] = nullableText(source[key], key);
  if (has(source, "timezone")) result.timezone = text(source.timezone, "timezone");
  if (has(source, "defaultWorkerCount")) result.defaultWorkerCount = number(source.defaultWorkerCount, "defaultWorkerCount", 1, true);
  if (has(source, "defaultWorkingHours")) result.defaultWorkingHours = workingHours(source.defaultWorkingHours);
  if (!create && Object.keys(result).length === 0) throw new ApiError(400, "Request body must include at least one field");
  return result;
}
