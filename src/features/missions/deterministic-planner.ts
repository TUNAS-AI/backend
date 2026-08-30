import type { DryingProfile, GeneratedPlan, MissionFact, PlanInfeasibility, PlanningResult, PlannedActivity, ScheduleChange, ScheduleEdit, SchedulingDurations } from "./mission.types";

type WorkingHours = Record<string, Array<{ start: string; end: string }>>;
type CompletedStep = PlannedActivity & { status: string; actualQuantityKg?: unknown };
export type PlannerInput = { facts: MissionFact; dryingProfile: DryingProfile | null; schedulingDurations: unknown; timezone: string; workingHours: unknown; weather: unknown; now?: Date; completedSteps?: CompletedStep[] };
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const result = (status: PlanningResult["status"], plans: GeneratedPlan[] = [], infeasibility: PlanInfeasibility | null = null): PlanningResult => ({ status, plans, infeasibility });
const fail = (code: PlanInfeasibility["code"], reason: string, details: Record<string, unknown> = {}) => result(code === "NEEDS_INPUT" ? "NEEDS_INPUT" : "INFEASIBLE", [], { code, reason, details });
const activity = (actionKind: PlannedActivity["actionKind"], title: string, description: string, date: string, start: string | null, end: string | null, timezone: string, stage: PlannedActivity["stage"], extra: Partial<PlannedActivity> = {}): PlannedActivity => ({ actionKind, title, description, scheduleType: start && end ? "DAILY_WINDOW" : "CONDITION_GATE", startsOn: date, endsOn: date, windowStart: start, windowEnd: end, timezone, isConditional: false, stage, ...extra });
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

function allocate(workingHours: WorkingHours, earliestDate: string, earliestTime: string | null, duration: number, lastDate: string) {
  for (let date = earliestDate; date <= lastDate; date = addDays(date, 1)) {
    const ranges = [...(workingHours[weekdays[new Date(`${date}T12:00:00.000Z`).getUTCDay()]] ?? [])].sort((left, right) => left.start.localeCompare(right.start));
    for (const range of ranges) {
      const start = Math.max(minutes(range.start), date === earliestDate && earliestTime ? minutes(earliestTime) : 0);
      if (start + duration <= minutes(range.end)) return { date, start: time(start), end: time(start + duration) };
    }
  }
  return null;
}

type EditableStep = PlannedActivity & { missionStepId: string; sequence: number; status: string };
const localMinute = (date: string, value: string) => Date.parse(`${date}T${value}:00.000Z`) / 60_000;
const localParts = (value: number) => ({ date: new Date(value * 60_000).toISOString().slice(0, 10), time: new Date(value * 60_000).toISOString().slice(11, 16) });
function instantAsLocalMinute(value: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return localMinute(`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`);
}
const duration = (step: EditableStep) => step.windowStart && step.windowEnd ? minutes(step.windowEnd) - minutes(step.windowStart) : 0;
function inWorkWindow(workingHours: WorkingHours, date: string, start: string, end: string) {
  return (workingHours[weekdays[new Date(`${date}T12:00:00.000Z`).getUTCDay()]] ?? []).some((range) => start >= range.start && end <= range.end);
}

export function applyScheduleEdit(input: { steps: EditableStep[]; edit: ScheduleEdit; workingHours: unknown; deadlineAt: string; timezone: string }) {
  const workingHours = input.workingHours as WorkingHours;
  const scheduled = input.steps.filter((step) => step.status === "SCHEDULED").sort((left, right) => left.sequence - right.sequence);
  const changed = new Map<string, EditableStep>();
  if (input.edit.type === "SHIFT_ACTIVITY") {
    const edit = input.edit;
    const target = scheduled.find((step) => step.missionStepId === edit.missionStepId);
    if (!target || target.scheduleType !== "DAILY_WINDOW" || !target.windowStart) return { error: "Kegiatan yang dipilih tidak lagi dapat dijadwalkan ulang." } as const;
    let previousEnd = -Infinity;
    let cascadeDayDelta = 0;
    for (const step of scheduled.filter((item) => item.sequence >= target.sequence)) {
      if (step.scheduleType === "CONDITION_GATE") {
        const shiftedDate = addDays(step.startsOn, cascadeDayDelta);
        changed.set(step.missionStepId, { ...step, startsOn: shiftedDate, endsOn: shiftedDate });
        continue;
      }
      if (!step.windowStart || !step.windowEnd) return { error: "Jadwal kegiatan tidak memiliki waktu yang valid." } as const;
      const desired = localMinute(step.startsOn, step.windowStart) + edit.deltaMinutes;
      const earliest = localParts(Math.max(desired, previousEnd));
      const slot = allocate(workingHours, earliest.date, earliest.time, duration(step), addDays(input.deadlineAt.slice(0, 10), 30));
      if (!slot) return { error: "Tidak ada jam kerja yang cukup untuk menerapkan perubahan ini." } as const;
      const next = { ...step, startsOn: slot.date, endsOn: slot.date, windowStart: slot.start, windowEnd: slot.end };
      changed.set(step.missionStepId, next); previousEnd = localMinute(slot.date, slot.end);
      cascadeDayDelta = Math.max(cascadeDayDelta, Math.floor((previousEnd - localMinute(step.endsOn, step.windowEnd)) / 1_440));
    }
  } else {
    const edit = input.edit;
    if (edit.toDate <= edit.fromDate) return { error: "Tanggal tujuan harus setelah tanggal asal." } as const;
    const targets = scheduled.filter((step) => step.scheduleType === "DAILY_WINDOW" && step.startsOn === edit.fromDate);
    if (!targets.length) return { error: "Tidak ada kegiatan terjadwal pada tanggal asal tersebut." } as const;
    const dayDelta = Math.round((Date.parse(`${edit.toDate}T12:00:00Z`) - Date.parse(`${edit.fromDate}T12:00:00Z`)) / 86_400_000);
    for (const step of targets) {
      if (!step.windowStart || !step.windowEnd || !inWorkWindow(workingHours, edit.toDate, step.windowStart, step.windowEnd)) return { error: "Jadwal yang dipindahkan tidak sesuai dengan jam kerja pada tanggal tujuan." } as const;
      changed.set(step.missionStepId, { ...step, startsOn: edit.toDate, endsOn: edit.toDate });
    }
    for (const step of scheduled.filter((step) => step.scheduleType === "CONDITION_GATE" && step.startsOn === edit.fromDate)) changed.set(step.missionStepId, { ...step, startsOn: addDays(step.startsOn, dayDelta), endsOn: addDays(step.endsOn, dayDelta) });
  }
  const activities = scheduled.map((step) => changed.get(step.missionStepId) ?? step);
  const timed = activities.filter((step) => step.scheduleType === "DAILY_WINDOW" && step.windowStart && step.windowEnd);
  for (let index = 1; index < timed.length; index += 1) if (localMinute(timed[index].startsOn, timed[index].windowStart!) < localMinute(timed[index - 1].endsOn, timed[index - 1].windowEnd!)) return { error: "Perubahan akan membuat urutan kegiatan saling bertabrakan." } as const;
  const lastHarvesting = timed.filter((step) => step.stage === "HARVESTING").at(-1);
  if (lastHarvesting && localMinute(lastHarvesting.endsOn, lastHarvesting.windowEnd!) > instantAsLocalMinute(input.deadlineAt, input.timezone)) return { error: "Perubahan melewati batas waktu misi." } as const;
  const changes: ScheduleChange[] = scheduled.flatMap((step) => {
    const after = changed.get(step.missionStepId); if (!after || (after.startsOn === step.startsOn && after.windowStart === step.windowStart && after.windowEnd === step.windowEnd)) return [];
    return [{ missionStepId: step.missionStepId, actionKind: step.actionKind, title: step.title, before: { date: step.startsOn, start: step.windowStart, end: step.windowEnd }, after: { date: after.startsOn, start: after.windowStart, end: after.windowEnd } }];
  });
  if (!changes.length) return { error: "Permintaan ini tidak mengubah jadwal aktif." } as const;
  const plan: GeneratedPlan = { name: "Perubahan jadwal sesuai permintaan", summary: "Jadwal mendatang disesuaikan sesuai permintaan petani dan jam kerja kebun.", recommended: true, evidence: [{ evidenceId: "constraint:schedule-edit", source: "MISSION_CONSTRAINT", rule: "requested schedule change applied", passed: true, value: true }], assumptions: [], risks: { solverVersion: "schedule-edit-v1" }, dryingEstimateDays: 0, dryingEstimateMinDays: 0, dryingEstimateMaxDays: 0, dryingEstimateReason: "Jadwal pengeringan yang ada dipertahankan.", weatherStatus: "WEATHER_UNVERIFIED", activities: activities.map(({ missionStepId: _id, sequence: _sequence, status: _status, ...activity }) => activity) };
  return { plan, changes } as const;
}

function weatherRisk(weather: unknown, date: string, start: string, end: string) {
  const hourly = (weather as { hourly?: { time?: unknown; precipitation_probability?: unknown } })?.hourly;
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const probabilities = Array.isArray(hourly?.precipitation_probability) ? hourly.precipitation_probability : [];
  const indexes = times.flatMap((time, index) => typeof time === "string" && time.slice(0, 10) === date && time.slice(11, 16) >= start && time.slice(11, 16) < end ? [index] : []);
  return { verified: indexes.length > 0, probability: indexes.length ? Math.max(0, ...indexes.map((index) => Number(probabilities[index]) || 0)) : 101 };
}

export function generateFeasiblePlans(input: PlannerInput): PlanningResult {
  const missing = (["fieldBlockId", "cropBatchIds", "readinessConfirmed", "destination", "plannedHarvestKg", "deadlineAt"] as const).filter((key) => input.facts[key] === null || input.facts[key] === undefined || (Array.isArray(input.facts[key]) && !(input.facts[key] as unknown[]).length));
  if (missing.length) return fail("NEEDS_INPUT", "Complete the essential mission details before planning.", { fields: missing });
  if (!input.facts.readinessConfirmed) return fail("NOT_READY", "Confirm that the crop is ready before creating a harvest plan.");
  if (!input.dryingProfile) return fail("NEEDS_INPUT", "Add a drying profile in Farm details before planning.", { fields: ["dryingProfile"] });
  const facts = input.facts as MissionFact & { plannedHarvestKg: number; deadlineAt: string };
  const profile = input.dryingProfile;
  if (profile.minDays > profile.maxDays) return fail("NEEDS_INPUT", "The farm drying range is invalid.", { fields: ["dryingProfile"] });
  if (facts.plannedHarvestKg > profile.capacityKg) return fail("RESOURCE_CAPACITY", "The amount exceeds the farm drying capacity. Reduce the amount or update Farm details.", { targetKg: facts.plannedHarvestKg, dryingCapacityKg: profile.capacityKg });
  const workingHours = input.workingHours as WorkingHours | null;
  if (!workingHours || !Object.values(workingHours).some((ranges) => ranges.length)) return fail("MISSING_WORKING_HOURS", "Add farm work hours before planning.");
  const durations = input.schedulingDurations as SchedulingDurations | null;
  if (!durations || Object.values(durations).some((value) => !Number.isInteger(value) || value < 1)) return fail("NEEDS_INPUT", "Add valid scheduling durations in Farm details before planning.", { fields: ["schedulingDurations"] });

  const completed = (input.completedSteps ?? []).filter((step) => step.status === "COMPLETED");
  const done = new Set(completed.map((step) => step.actionKind));
  const completedHarvestKg = completed.filter((step) => step.actionKind === "HARVEST").reduce((sum, step) => sum + (Number(step.actualQuantityKg) || step.quantityKg || step.targetHarvestKg || 0), 0);
  const remainingKg = Math.max(0, facts.plannedHarvestKg - completedHarvestKg);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone }).format(input.now ?? new Date());
  const deadlineDate = facts.deadlineAt.slice(0, 10);
  const candidates: Array<GeneratedPlan & { risk: number }> = [];

  for (let offset = 0; offset < 30 && candidates.length < 3; offset += 1) {
    const date = addDays(today, offset);
    if (date > deadlineDate) break;
    const ranges = workingHours[weekdays[new Date(`${date}T12:00:00.000Z`).getUTCDay()]] ?? [];
    const range = ranges[0];
    if (!range) continue;
    const risk = weatherRisk(input.weather, date, range.start, range.end);
    const activities: PlannedActivity[] = [];
    let cursorDate = date; let cursorTime: string | null = range.start;
    const schedule = (actionKind: PlannedActivity["actionKind"], title: string, description: string, duration: number, stage: PlannedActivity["stage"], extra: Partial<PlannedActivity> = {}) => {
      const slot = allocate(workingHours, cursorDate, cursorTime, duration, deadlineDate);
      if (!slot) return false;
      activities.push(activity(actionKind, title, description, slot.date, slot.start, slot.end, input.timezone, stage, extra));
      cursorDate = slot.date; cursorTime = slot.end;
      return true;
    };
    if (!done.has("CONFIRM_READINESS_WEATHER") && !schedule("CONFIRM_READINESS_WEATHER", "Check crop and field conditions", "Confirm the crop is still ready and the field is workable before starting.", durations.readinessCheckMinutes, "HARVESTING")) continue;
    const harvestMinutes = facts.harvestDurationMinutes ?? durations.harvestMinutes;
    if (remainingKg > 0 && !schedule("HARVEST", "Harvest shallots", `Harvest during the scheduled farm work period${facts.workers ? ` with ${facts.workers} workers` : ""}.`, harvestMinutes, "HARVESTING", { targetHarvestKg: remainingKg, quantityKg: remainingKg, workers: facts.workers, resourceDemands: facts.workers ? [{ resource: "workers", amount: facts.workers, unit: "person" }] : [] })) continue;
    if (!done.has("TRANSFER_TO_DRYING") && !schedule("TRANSFER_TO_DRYING", "Move harvest to drying area", "Move harvested shallots to the configured farm drying area after harvest.", durations.transferToDryingMinutes, "HARVESTING", { quantityKg: facts.plannedHarvestKg })) continue;
    if (!done.has("BEGIN_DRYING") && !schedule("BEGIN_DRYING", "Begin condition-based drying", `Use the farm's ${profile.method.toLowerCase().replaceAll("_", " ")} method. The ${profile.minDays}-${profile.maxDays} day range is guidance, not automatic completion.`, durations.beginDryingMinutes, "DRYING", { quantityKg: facts.plannedHarvestKg })) continue;
    const dryingStartDate = cursorDate;
    let inspectionCursorDate = ""; let inspectionCursorTime: string | null = null; let inspectionsFit = true;
    for (let day = Math.max(1, profile.minDays); day <= profile.maxDays; day += 3) {
      const targetDate = addDays(dryingStartDate, day);
      const slot = allocate(workingHours, targetDate > inspectionCursorDate ? targetDate : inspectionCursorDate, targetDate > inspectionCursorDate ? null : inspectionCursorTime, durations.dryingInspectionMinutes, addDays(targetDate, 6));
      if (!slot) { inspectionsFit = false; break; }
      activities.push(activity("INSPECT_DRYING", "Inspect drying condition", "Check necks, tops, outer scales, wet pockets, condensation, decay, and damage.", slot.date, slot.start, slot.end, input.timezone, "DRYING"));
      inspectionCursorDate = slot.date; inspectionCursorTime = slot.end;
    }
    if (!inspectionsFit) continue;
    if (!done.has("CONFIRM_DRYING_COMPLETE")) activities.push(activity("CONFIRM_DRYING_COMPLETE", "Farmer confirms drying completion", "Complete only after the farmer confirms the observable drying checklist.", addDays(dryingStartDate, profile.maxDays), null, null, input.timezone, "DRYING", { isConditional: true, quantityKg: facts.plannedHarvestKg }));
    const weatherStatus = risk.verified ? "VERIFIED" as const : "WEATHER_UNVERIFIED" as const;
    candidates.push({ risk: risk.probability, name: `${date} harvest`, summary: `Harvest ${facts.plannedHarvestKg} kg during farm hours, then use the farm drying profile and condition checks.`, recommended: false, evidence: [{ evidenceId: "constraint:readiness", source: "MISSION_CONSTRAINT", rule: "farmer confirmed readiness", passed: true, value: true }, { evidenceId: "resource:drying", source: "RESOURCE", rule: "amount fits farm drying capacity", passed: true, value: profile.capacityKg }, { evidenceId: "weather:harvest", source: "WEATHER", rule: "lower forecast rain risk is preferred", passed: true, value: risk.verified ? risk.probability : null }], tradeoffs: [risk.verified ? `Forecast rain probability: ${risk.probability}%.` : "Weather is outside the available forecast and must be checked again."], assumptions: [facts.harvestDurationMinutes ? "Harvest duration was reported by the farmer." : "Harvest duration uses the configured farm default."], risks: { weatherStatus, dryingCompletion: "Farmer checklist required", solverVersion: "harvest-drying-mvp-v1" }, dryingEstimateDays: profile.maxDays, dryingEstimateMinDays: profile.minDays, dryingEstimateMaxDays: profile.maxDays, dryingEstimateReason: "Farm drying profile; elapsed time triggers checks only.", weatherStatus, activities });
  }
  if (!candidates.length) return fail("DEADLINE_UNREACHABLE", "No farm working period is available before the mission deadline.");
  candidates.sort((left, right) => left.risk - right.risk || left.name.localeCompare(right.name));
  const plans = candidates.map(({ risk: _risk, ...plan }) => plan);
  return result(plans.some((plan) => plan.weatherStatus === "WEATHER_UNVERIFIED") ? "WEATHER_UNVERIFIED" : "READY_TO_PLAN", plans);
}

export function validatePlan(plan: GeneratedPlan, input: PlannerInput) { return generateFeasiblePlans(input).plans.some((candidate) => JSON.stringify(candidate.activities) === JSON.stringify(plan.activities)); }
