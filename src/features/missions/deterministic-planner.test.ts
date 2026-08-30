import assert from "node:assert/strict";
import test from "node:test";
import { generateFeasiblePlans, validatePlan } from "./deterministic-planner";
import type { MissionFact } from "./mission.types";

const facts: MissionFact = { fieldBlockId: "field", cropBatchIds: ["batch"], marketQuality: "Grade A", plannedHarvestKg: 80, plannedDriedKg: 70, deadline: "2026-09-10T16:59:59.999Z", harvestDurationHours: 6, estimatedHarvestableKg: 100, rainProtectionAvailable: true, availableWorkerCount: null, coveredDryingCapacityKg: null, notes: null, clarification: null };
const workingHours = { monday: [{ start: "06:00", end: "12:00" }], tuesday: [{ start: "06:00", end: "12:00" }], wednesday: [{ start: "06:00", end: "12:00" }], thursday: [{ start: "06:00", end: "12:00" }], friday: [{ start: "06:00", end: "12:00" }] };
const input = { facts, timezone: "Asia/Jakarta", workingHours, weather: {}, now: new Date("2026-09-01T00:00:00.000Z") };

test("generates at most three deterministic harvest-then-drying candidates", () => {
  const result = generateFeasiblePlans(input);
  assert.equal(result.plans.length, 3);
  assert.equal(result.infeasibility, null);
  for (const plan of result.plans) {
    const harvestEnd = plan.activities.filter((activity) => activity.stage === "HARVESTING").at(-1)?.endsOn;
    const dryingStart = plan.activities.find((activity) => activity.title === "Begin and inspect drying")?.startsOn;
    assert.equal(dryingStart, harvestEnd);
  }
});

test("uses precipitation amount as a hard constraint and probability only as ranking risk", () => {
  const probabilityOnly = generateFeasiblePlans({ ...input, weather: { hourly: { time: ["2026-09-01T06:00"], precipitation: [0], precipitation_probability: [100] } } });
  assert.ok(probabilityOnly.plans.length > 0);
  const rainyHours = ["2026-09-01T06:00", "2026-09-02T06:00", "2026-09-03T06:00", "2026-09-04T06:00", "2026-09-07T06:00", "2026-09-08T06:00", "2026-09-09T06:00", "2026-09-10T06:00"];
  const actualRain = generateFeasiblePlans({ ...input, weather: { hourly: { time: rainyHours, precipitation: rainyHours.map(() => 2), precipitation_probability: rainyHours.map(() => 10) } } });
  assert.equal(actualRain.plans.length, 0);
  assert.equal(actualRain.infeasibility?.code, "NO_DRY_HARVEST_WINDOW");
});

test("does not classify trace precipitation at the 0.1 mm threshold as rain", () => {
  const result = generateFeasiblePlans({ ...input, weather: { hourly: { time: ["2026-09-01T06:00"], precipitation: [0.1], precipitation_probability: [90] } } });
  assert.ok(result.plans.length > 0);
});

test("returns structured quantity infeasibility without calculating productivity", () => {
  const result = generateFeasiblePlans({ ...input, facts: { ...facts, plannedHarvestKg: 101 } });
  assert.deepEqual(result.infeasibility, { code: "QUANTITY_UNAVAILABLE", reason: "The confirmed harvest target exceeds the confirmed available quantity.", details: { targetKg: 101, availableKg: 100 } });
});

test("rejects an approved candidate when fresh precipitation invalidates it", () => {
  const plan = generateFeasiblePlans(input).plans[0];
  assert.equal(validatePlan(plan, input), true);
  const harvest = plan.activities.find((activity) => activity.stage === "HARVESTING")!;
  assert.equal(validatePlan(plan, { ...input, weather: { hourly: { time: [`${harvest.startsOn}T${harvest.windowStart}`], precipitation: [1], precipitation_probability: [20] } } }), false);
});

test("replanning keeps completed harvest immutable and schedules only remaining drying", () => {
  const completed = [{ title: "Harvest shallots", description: "Done", scheduleType: "DAILY_WINDOW" as const, startsOn: "2026-09-01", endsOn: "2026-09-01", windowStart: "06:00", windowEnd: "12:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" as const, status: "COMPLETED", targetHarvestKg: 80 }];
  const result = generateFeasiblePlans({ ...input, completedSteps: completed });
  assert.ok(result.plans.length > 0);
  assert.equal(result.plans[0].activities.some((activity) => activity.stage === "HARVESTING"), false);
  assert.equal(result.plans[0].activities[0].startsOn, "2026-09-01");
});
