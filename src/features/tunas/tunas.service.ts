import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { getOpenMeteoForecast } from "../../agent/missions/open-meteo.client";
import { TunasRepository } from "./tunas.repository";
import type { TunasAction } from "./tunas.types";

type WeatherHour = { time?: unknown; precipitation_probability?: unknown; precipitation?: unknown };
const rain = (hour: WeatherHour, dates: Set<string>) => typeof hour.time === "string" && dates.has(hour.time.slice(0, 10)) && Number(hour.precipitation_probability) >= 60 && Number(hour.precipitation) >= 1;
const localDate = (date: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const action = (id: TunasAction["id"], label: string): TunasAction => ({ id, label });

export function chooseDemoMission<T>(missions: readonly T[], random = Math.random): T | null {
  return missions.length ? missions[Math.floor(random() * missions.length)] ?? null : null;
}

export class TunasService {
  constructor(private readonly repository = new TunasRepository(), private readonly farmIdForOwner = callerFarmId, private readonly forecast = getOpenMeteoForecast, private readonly random = Math.random) {}

  async messages(ownerId: string) { return this.repository.messages(await this.farmIdForOwner(ownerId)); }
  async markRead(ownerId: string) { return this.repository.markRead(await this.farmIdForOwner(ownerId)); }

  async dailyCheck(ownerId: string) {
    const farmId = await this.farmIdForOwner(ownerId); const farm = await this.repository.farm(farmId);
    const today = new Date(`${localDate(new Date(), farm.timezone)}T00:00:00.000Z`);
    if (await this.repository.hasChecked(farmId, today)) return this.repository.messages(farmId);
    const missions = await this.repository.activeMissions(farmId);
    await Promise.all(missions.filter((mission) => mission.fieldBlock).map(async (mission) => {
      const field = mission.fieldBlock!;
      const weather = await this.forecast(Number(field.latitude), Number(field.longitude), farm.timezone);
      const hourly = weather.hourly as { time?: unknown; precipitation_probability?: unknown; precipitation?: unknown } | undefined;
      const times = Array.isArray(hourly?.time) ? hourly.time : [];
      const days = new Set(times.slice(0, 72).filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 10)));
      const hours = times.map((time, index) => ({ time, precipitation_probability: Array.isArray(hourly?.precipitation_probability) ? hourly.precipitation_probability[index] : null, precipitation: Array.isArray(hourly?.precipitation) ? hourly.precipitation[index] : null }));
      const rainDays = new Set(hours.filter((hour) => rain(hour, days)).map((hour) => String(hour.time).slice(0, 10)));
      const overlapsForecast = (step: { startsOn: Date; endsOn: Date }) => [...days].some((day) => day >= localDate(step.startsOn, farm.timezone) && day <= localDate(step.endsOn, farm.timezone));
      const drying = mission.missionSteps.some((step) => step.stage === "DRYING" && overlapsForecast(step) && rainDays.size);
      const harvest = mission.missionSteps.some((step) => step.stage === "HARVESTING" && overlapsForecast(step) && rainDays.size);
      const prefix = `${localDate(new Date(), farm.timezone)}:${mission.missionId}`;
      if (rainDays.size >= 2) await this.repository.createMessage({ farmId, missionId: mission.missionId, kind: "irregular-rain", dedupeKey: `${prefix}:irregular`, content: "Rain is expected on multiple days around this mission. I can generate three safer replacement plans using the new forecast.", actions: [action("regenerate", "Generate 3 plans"), action("keep", "Keep current plan")] });
      else if (harvest) await this.repository.createMessage({ farmId, missionId: mission.missionId, kind: "harvest-rain", dedupeKey: `${prefix}:harvest`, content: "Rain may disrupt this harvest window. Rescheduling can protect the harvest and drying handoff.", actions: [action("reschedule", "Reschedule"), action("keep", "Keep current plan")] });
      else if (drying) await this.repository.createMessage({ farmId, missionId: mission.missionId, kind: "drying-rain", dedupeKey: `${prefix}:drying`, content: "Rain may reach shallots during drying. Cover the drying area before the forecast window.", actions: [] });
    }));
    await this.repository.markChecked(farmId, today);
    return this.repository.messages(farmId);
  }

  async act(ownerId: string, messageId: string, requested: TunasAction["id"]) {
    const farmId = await this.farmIdForOwner(ownerId); const message = await this.repository.message(farmId, messageId);
    if (!message) throw new ApiError(404, "Tunas message not found");
    if (!message.actions.some((item) => item.id === requested)) throw new ApiError(409, "That Tunas action is not available");
    await this.repository.consumeAction(farmId, messageId);
    await this.repository.createMessage({ farmId, missionId: message.missionId, kind: "farmer-decision", role: "farmer", content: requested === "keep" ? "Keep the current mission plan." : requested === "regenerate" ? "Generate replacement plans for the irregular rain forecast." : "Reschedule this harvest because of the rain forecast." });
    if (requested === "keep" || !message.missionId) return { messages: await this.repository.markRead(farmId), navigation: null };
    return { messages: await this.repository.markRead(farmId), navigation: { missionId: message.missionId, draft: requested === "regenerate" ? "Regenerate three harvest and drying plans around the irregular rain forecast." : "Reschedule the harvest and drying plan around the rain forecast.", autoGenerate: requested === "regenerate" } };
  }

  async test(ownerId: string, scenario: "drying-rain" | "harvest-rain" | "irregular-rain") {
    const farmId = await this.farmIdForOwner(ownerId); const mission = chooseDemoMission(await this.repository.activeMissions(farmId), this.random);
    if (!mission) throw new ApiError(409, "Create and approve an active mission before using this Tunas demo.");
    const config = scenario === "drying-rain" ? { content: "Demo: rain is about to hit drying. Cover the shallots before the rain arrives.", actions: [] } : scenario === "harvest-rain" ? { content: "Demo: rain may hit harvest. Would you like to reschedule or keep the current plan?", actions: [action("reschedule", "Reschedule"), action("keep", "Keep current plan")] } : { content: "Demo: rain is irregular across the forecast. I can generate three replacement plans.", actions: [action("regenerate", "Generate 3 plans"), action("keep", "Keep current plan")] };
    await this.repository.createMessage({ farmId, missionId: mission.missionId, kind: scenario, content: config.content, actions: config.actions });
    return this.repository.messages(farmId);
  }
}
