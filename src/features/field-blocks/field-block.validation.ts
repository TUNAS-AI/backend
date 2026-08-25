import { ApiError } from "../../shared/api-error";
import { has, input, nullableText, number, text, type Input } from "../../shared/input-validation";
export type FieldBlockInput = Input;
function coordinates(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError(400, "coordinates must be a JSON object");
  const source = value as Input; const latitude = number(source.latitude, "coordinates.latitude", -90); const longitude = number(source.longitude, "coordinates.longitude", -180);
  if (latitude > 90) throw new ApiError(400, "coordinates.latitude must be a number between -90 and 90");
  if (longitude > 180) throw new ApiError(400, "coordinates.longitude must be a number between -180 and 180");
  return { latitude, longitude };
}
export function parseFieldBlock(value: unknown, create: boolean): FieldBlockInput {
  const source = input(value); const result: FieldBlockInput = {};
  if (create) { result.name = text(source.name, "name"); Object.assign(result, coordinates(source.coordinates)); }
  else if (has(source, "name")) result.name = text(source.name, "name");
  if (has(source, "areaHectares")) result.areaHectares = source.areaHectares === null ? null : number(source.areaHectares, "areaHectares", Number.MIN_VALUE);
  if (has(source, "coordinates")) Object.assign(result, coordinates(source.coordinates));
  for (const key of ["notes", "status"] as const) if (has(source, key)) result[key] = key === "notes" ? nullableText(source[key], key) : text(source[key], key);
  if (!create && Object.keys(result).length === 0) throw new ApiError(400, "Request body must include at least one field");
  return result;
}
