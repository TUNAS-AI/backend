import type { GeneratedPlan, MissionFact, PlanInfeasibility, PlanningResult, PlannedActivity } from "./mission.types";

type WorkingHours = Record<string, Array<{ start: string; end: string }>>;
type Weather = { hourly?: { time?: unknown; precipitation?: unknown; precipitation_probability?: unknown } };
type CompletedStep = { title: string; description: string; scheduleType: "DAILY_WINDOW" | "DATE_RANGE"; startsOn: Date | string; endsOn: Date | string; windowStart: string | null; windowEnd: string | null; timezone: string; isConditional: boolean; stage: "HARVESTING" | "DRYING"; status: string; targetHarvestKg?: unknown };
type PlannerInput = { facts: MissionFact; timezone: string; workingHours: unknown; weather: unknown; now?: Date; completedSteps?: CompletedStep[] };

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const dateString = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => dateString(new Date(Date.parse(`${date}T12:00:00.000Z`) + days * 86_400_000));
const hours = (start: string, end: string) => (Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - Number(start.slice(0, 2)) * 60 - Number(start.slice(3))) / 60;
const dateValue = (value: Date | string) => value instanceof Date ? dateString(value) : value.slice(0, 10);

function infeasible(code: PlanInfeasibility["code"], reason: string, details: Record<string, unknown> = {}): PlanningResult { return { plans: [], infeasibility: { code, reason, details } }; }
function normalizedWeather(weather: unknown) {
  const hourly = (weather as Weather).hourly;
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  return times.flatMap((time, index) => typeof time === "string" ? [{ time, precipitation: Array.isArray(hourly?.precipitation) ? Number(hourly.precipitation[index]) : 0, probability: Array.isArray(hourly?.precipitation_probability) ? Number(hourly.precipitation_probability[index]) : 0 }] : []);
}
function rainsDuring(weather: ReturnType<typeof normalizedWeather>, date: string, start = "00:00", end = "24:00") { return weather.some((hour) => hour.time.slice(0, 10) === date && hour.time.slice(11, 16) >= start && hour.time.slice(11, 16) < end && hour.precipitation > 0.1); }
function riskDuring(weather: ReturnType<typeof normalizedWeather>, activities: PlannedActivity[]) {
  return Math.max(0, ...weather.filter((hour) => activities.some((activity) => activity.stage === "HARVESTING" && activity.startsOn === hour.time.slice(0, 10) && hour.time.slice(11, 16) >= (activity.windowStart ?? "00:00") && hour.time.slice(11, 16) < (activity.windowEnd ?? "24:00"))).map((hour) => hour.probability));
}

function completedActivities(steps: CompletedStep[] = []): PlannedActivity[] {
  return steps.filter((step) => step.status === "COMPLETED").map((step) => ({ title: step.title, description: step.description, scheduleType: step.scheduleType, startsOn: dateValue(step.startsOn), endsOn: dateValue(step.endsOn), windowStart: step.windowStart, windowEnd: step.windowEnd, timezone: step.timezone, isConditional: step.isConditional, stage: step.stage, targetHarvestKg: Number(step.targetHarvestKg) || null }));
}

export function generateFeasiblePlans(input: PlannerInput): PlanningResult {
  const workingHours = input.workingHours as WorkingHours | null;
  if (!workingHours || !Object.values(workingHours).some((ranges) => Array.isArray(ranges) && ranges.length)) return infeasible("MISSING_WORKING_HOURS", "Farm working hours are required for deterministic planning.");
  if (input.facts.estimatedHarvestableKg !== null && input.facts.plannedHarvestKg !== null && input.facts.plannedHarvestKg > input.facts.estimatedHarvestableKg) return infeasible("QUANTITY_UNAVAILABLE", "The confirmed harvest target exceeds the confirmed available quantity.", { targetKg: input.facts.plannedHarvestKg, availableKg: input.facts.estimatedHarvestableKg });

  const completed = completedActivities(input.completedSteps);
  const harvestCompleted = completed.some((step) => step.stage === "HARVESTING");
  const dryingCompleted = completed.some((step) => step.stage === "DRYING");
  const duration = harvestCompleted ? 0 : input.facts.harvestDurationHours ?? 0;
  const weather = normalizedWeather(input.weather);
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(input.now ?? new Date());
  const deadlineDate = input.facts.deadline?.slice(0, 10) ?? addDays(localToday, 15);
  const starts: string[] = [];
  for (let offset = 0; offset <= 15 && starts.length < 12; offset += 1) {
    const day = addDays(localToday, offset); if (day > deadlineDate) break;
    const ranges = workingHours[weekdays[new Date(`${day}T12:00:00.000Z`).getUTCDay()]] ?? [];
    if (ranges.length) starts.push(day);
  }
  if (!harvestCompleted && !starts.length) return infeasible("DEADLINE_UNREACHABLE", "No farm working window exists before the deadline.", { deadline: input.facts.deadline });

  const candidates: GeneratedPlan[] = [];
  let unprotectedDryingRain = false;
  for (const firstDay of harvestCompleted ? [completed.filter((step) => step.stage === "HARVESTING").at(-1)?.endsOn ?? localToday] : starts) {
    let remaining = duration; const harvest: PlannedActivity[] = [];
    for (let offset = 0; offset <= 15 && remaining > 0; offset += 1) {
      const day = addDays(firstDay, offset); if (day > deadlineDate) break;
      const ranges = workingHours[weekdays[new Date(`${day}T12:00:00.000Z`).getUTCDay()]] ?? [];
      for (const range of ranges) {
        if (rainsDuring(weather, day, range.start, range.end)) continue;
        const used = Math.min(remaining, hours(range.start, range.end));
        const endMinutes = Number(range.start.slice(0, 2)) * 60 + Number(range.start.slice(3)) + used * 60;
        const windowEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(Math.round(endMinutes % 60)).padStart(2, "0")}`;
        harvest.push({ title: "Harvest shallots", description: "Complete the farmer-confirmed harvest work.", scheduleType: "DAILY_WINDOW", startsOn: day, endsOn: day, windowStart: range.start, windowEnd, timezone: input.timezone, isConditional: false, stage: "HARVESTING", targetHarvestKg: harvest.length === 0 && used === remaining ? input.facts.plannedHarvestKg : null });
        remaining -= used; if (remaining <= 0) break;
      }
    }
    if (remaining > 0) continue;
    const harvestEnd = harvest.at(-1)?.endsOn ?? firstDay;
    const dryingStart = harvestEnd; const dryingEnd = addDays(dryingStart, 2);
    if (dryingEnd > deadlineDate || dryingCompleted) { if (!dryingCompleted && dryingEnd > deadlineDate) continue; }
    const dryingRain = [dryingStart, addDays(dryingStart, 1), dryingEnd].some((day) => rainsDuring(weather, day));
    if (dryingRain && input.facts.rainProtectionAvailable !== true) { unprotectedDryingRain = true; continue; }
    const activities = [...harvest];
    if (!dryingCompleted) {
      if (dryingRain) activities.push({ title: "Protect drying shallots from rain", description: "Cover or move the shallots before forecast rainfall.", scheduleType: "DATE_RANGE", startsOn: dryingStart, endsOn: dryingStart, windowStart: null, windowEnd: null, timezone: input.timezone, isConditional: false, stage: "DRYING" });
      activities.push({ title: "Begin and inspect drying", description: "Begin drying after harvest and let the farmer confirm completion.", scheduleType: "DATE_RANGE", startsOn: dryingStart, endsOn: dryingEnd, windowStart: null, windowEnd: null, timezone: input.timezone, isConditional: true, stage: "DRYING" });
    }
    if (!activities.length) continue;
    const peakProbability = riskDuring(weather, harvest);
    candidates.push({ name: `Candidate ${candidates.length + 1}`, summary: `Harvest starts ${firstDay}; drying follows harvest.`, recommended: false, evidence: [`Fits the confirmed ${duration}-hour harvest duration inside farm working hours.`, "No harvest window overlaps hourly precipitation above 0.1 mm."], tradeoffs: [`Peak forecast precipitation probability during harvest is ${peakProbability}%.`], assumptions: ["Drying uses the two-day reference as an estimate; the farmer confirms completion."], risks: { precipitationProbability: `${peakProbability}% peak probability; used for ranking only.` }, dryingEstimateDays: 2, dryingEstimateReason: "Operational checkpoint estimate, not automatic completion.", activities });
    if (candidates.length === 3) break;
  }
  if (candidates.length) return { plans: candidates, infeasibility: null };
  const dryHarvestExists = starts.some((day) => (workingHours[weekdays[new Date(`${day}T12:00:00.000Z`).getUTCDay()]] ?? []).some((range) => !rainsDuring(weather, day, range.start, range.end)));
  if (!dryHarvestExists && !harvestCompleted) return infeasible("NO_DRY_HARVEST_WINDOW", "Forecast precipitation overlaps every usable harvest window before the deadline.");
  if (unprotectedDryingRain) return infeasible("DRYING_RAIN_UNPROTECTED", "Forecast precipitation overlaps exposed drying and no rain protection is confirmed.");
  return infeasible("DEADLINE_UNREACHABLE", "The confirmed harvest duration and required drying sequence cannot finish by the deadline.", { durationHours: duration, deadline: input.facts.deadline });
}

export function validatePlan(plan: GeneratedPlan, input: PlannerInput) {
  const generated = generateFeasiblePlans(input);
  return generated.plans.some((candidate) => JSON.stringify(candidate.activities) === JSON.stringify(plan.activities));
}
