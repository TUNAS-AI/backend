import assert from "node:assert/strict";
import test from "node:test";
import { applyScheduleEdit, generateFeasiblePlans, validatePlan } from "./deterministic-planner";
import type { MissionFact, PlannedActivity } from "./mission.types";

const facts: MissionFact = { fieldBlockId: "field", cropBatchIds: ["batch"], readinessConfirmed: true, destination: "IMMEDIATE_SALE", plannedHarvestKg: 80, deadlineAt: "2026-09-08T16:00:00.000Z", notes: null, clarification: null };
const dryingProfile = { method: "FIELD_SUN" as const, capacityKg: 100, protectedCapacityKg: 100, minDays: 21, maxDays: 28 };
const workingHours = { monday: [{ start: "06:00", end: "16:00" }], tuesday: [{ start: "06:00", end: "16:00" }], wednesday: [{ start: "06:00", end: "16:00" }], thursday: [{ start: "06:00", end: "16:00" }], friday: [{ start: "06:00", end: "16:00" }] };
const schedulingDurations = { readinessCheckMinutes: 15, harvestMinutes: 360, transferToDryingMinutes: 30, beginDryingMinutes: 15, dryingInspectionMinutes: 30 };
const input = { facts, dryingProfile, schedulingDurations, timezone: "Asia/Jakarta", workingHours, weather: {}, now: new Date("2026-08-31T17:00:00.000Z") };

test("builds a simple harvest and condition-based drying schedule", () => {
  const result = generateFeasiblePlans(input); const plan = result.plans[0];
  assert.equal(result.status, "WEATHER_UNVERIFIED"); assert.equal(result.plans.length, 3);
  assert.equal(plan.activities.find((step) => step.actionKind === "HARVEST")?.quantityKg, 80);
  assert.deepEqual(plan.activities.slice(0, 4).map((step) => [step.windowStart, step.windowEnd]), [["06:00", "06:15"], ["06:15", "12:15"], ["12:15", "12:45"], ["12:45", "13:00"]]);
  assert.equal(plan.dryingEstimateMinDays, 21); assert.equal(plan.dryingEstimateMaxDays, 28);
  assert.equal(plan.activities.at(-1)?.actionKind, "CONFIRM_DRYING_COMPLETE"); assert.equal(plan.activities.at(-1)?.scheduleType, "CONDITION_GATE");
  assert.equal(validatePlan(plan, input), true);
});

test("moves work to the next available window instead of overlapping", () => {
  const result = generateFeasiblePlans({ ...input, workingHours: { tuesday: [{ start: "06:00", end: "08:00" }, { start: "12:00", end: "16:00" }], wednesday: [{ start: "06:00", end: "16:00" }] }, schedulingDurations: { ...schedulingDurations, harvestMinutes: 240 } });
  const timed = result.plans[0].activities.slice(0, 4);
  assert.deepEqual(timed.map((step) => [step.startsOn, step.windowStart, step.windowEnd]), [["2026-09-01", "06:00", "06:15"], ["2026-09-01", "12:00", "16:00"], ["2026-09-02", "06:00", "06:30"], ["2026-09-02", "06:30", "06:45"]]);
});

test("uses farmer-reported harvest duration and worker count", () => {
  const result = generateFeasiblePlans({ ...input, facts: { ...facts, workers: 3, harvestDurationMinutes: 450 } });
  const harvest = result.plans[0]?.activities.find((activity) => activity.actionKind === "HARVEST");
  assert.equal(harvest?.workers, 3);
  assert.equal(harvest?.windowStart, "06:15");
  assert.equal(harvest?.windowEnd, "13:45");
});

test("requires readiness and farm drying capacity", () => {
  assert.equal(generateFeasiblePlans({ ...input, facts: { ...facts, readinessConfirmed: false } }).infeasibility?.code, "NOT_READY");
  assert.equal(generateFeasiblePlans({ ...input, dryingProfile: { ...dryingProfile, capacityKg: 79 } }).infeasibility?.code, "RESOURCE_CAPACITY");
  assert.equal(generateFeasiblePlans({ ...input, dryingProfile: null }).infeasibility?.code, "NEEDS_INPUT");
});

test("prefers lower forecast rain risk without blocking the mission", () => {
  const weather = { hourly: { time: ["2026-09-01T07:00", "2026-09-02T07:00"], precipitation_probability: [80, 20] } };
  const result = generateFeasiblePlans({ ...input, weather });
  assert.equal(result.plans[0].name, "2026-09-02 harvest"); assert.ok(result.plans.length);
});

const editable = (missionStepId: string, sequence: number, actionKind: PlannedActivity["actionKind"], date: string, start: string | null, end: string | null, stage: PlannedActivity["stage"] = "HARVESTING") => ({ missionStepId, sequence, status: "SCHEDULED", actionKind, title: actionKind, description: actionKind, scheduleType: start ? "DAILY_WINDOW" as const : "CONDITION_GATE" as const, startsOn: date, endsOn: date, windowStart: start, windowEnd: end, timezone: "Asia/Jakarta", isConditional: !start, stage });

test("delays an activity and cascades dependent work into later work windows", () => {
  const steps = [
    editable("00000000-0000-4000-8000-000000000001", 1, "CONFIRM_READINESS_WEATHER", "2026-08-29", "06:00", "06:15"),
    editable("00000000-0000-4000-8000-000000000002", 2, "HARVEST", "2026-08-29", "06:15", "12:15"),
    editable("00000000-0000-4000-8000-000000000003", 3, "TRANSFER_TO_DRYING", "2026-08-29", "12:15", "12:45"),
  ];
  const result = applyScheduleEdit({ steps, edit: { type: "SHIFT_ACTIVITY", missionStepId: steps[0].missionStepId, deltaMinutes: 120 }, workingHours: { saturday: [{ start: "06:00", end: "12:00" }], monday: [{ start: "06:00", end: "16:00" }] }, deadlineAt: "2026-09-01T16:00:00+07:00", timezone: "Asia/Jakarta" });
  if (!result.plan || !result.changes) throw new Error(result.error);
  assert.deepEqual(result.plan.activities.map((step) => [step.startsOn, step.windowStart, step.windowEnd]), [["2026-08-29", "08:00", "08:15"], ["2026-08-31", "06:00", "12:00"], ["2026-08-31", "12:00", "12:30"]]);
  assert.equal(result.changes.length, 3);
});

test("moves every scheduled activity on the requested date", () => {
  const steps = [
    editable("00000000-0000-4000-8000-000000000001", 1, "CONFIRM_READINESS_WEATHER", "2026-08-29", "06:00", "06:15"),
    editable("00000000-0000-4000-8000-000000000002", 2, "HARVEST", "2026-08-29", "06:15", "12:15"),
    editable("00000000-0000-4000-8000-000000000003", 3, "INSPECT_DRYING", "2026-09-08", "06:00", "06:30", "DRYING"),
  ];
  const result = applyScheduleEdit({ steps, edit: { type: "SHIFT_DATE", fromDate: "2026-08-29", toDate: "2026-08-30" }, workingHours: { sunday: [{ start: "06:00", end: "16:00" }] }, deadlineAt: "2026-08-31T16:00:00+07:00", timezone: "Asia/Jakarta" });
  if (!result.plan || !result.changes) throw new Error(result.error);
  assert.deepEqual(result.plan.activities.map((step) => step.startsOn), ["2026-08-30", "2026-08-30", "2026-09-08"]);
  assert.equal(result.changes.length, 2);
});
