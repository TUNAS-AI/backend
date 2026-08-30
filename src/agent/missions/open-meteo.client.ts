import { ApiError } from "../../shared/api-error";

const unavailable = () => new ApiError(409, "Weather forecast is temporarily unavailable; retry planning");

export function parseOpenMeteoForecast(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { hourly?: { time?: unknown } }).hourly?.time)) throw unavailable();
  return payload as Record<string, unknown>;
}

export async function getOpenMeteoForecast(latitude: number, longitude: number, timezone: string) {
  const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone, hourly: "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_gusts_10m,shortwave_radiation" });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) throw unavailable();
  return parseOpenMeteoForecast(await response.json());
}
