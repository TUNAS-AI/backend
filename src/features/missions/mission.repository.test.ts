import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { missionConfirmationTransactionOptions, planCreateData } from "./mission.repository";

test("allows confirmation writes enough time to commit on the hosted database", () => {
  assert.deepEqual(missionConfirmationTransactionOptions, { timeout: 15_000 });
});

test("keeps each generated activity nested under its own plan", () => {
  const data = planCreateData("mission", "run", {
    name: "Early harvest", summary: "Before rain", recommended: true, assumptions: [], risks: {}, dryingEstimateDays: 28, dryingEstimateMinDays: 21, dryingEstimateMaxDays: 28, dryingEstimateReason: "Farmer-approved local estimate.", weatherStatus: "VERIFIED",
    activities: [{ actionKind: "HARVEST", title: "Harvest", description: "Pick", scheduleType: "DAILY_WINDOW", startsOn: "2026-07-15", endsOn: "2026-07-15", windowStart: "08:00", windowEnd: "10:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" }],
  });
  assert.equal(data.name, "Early harvest");
  assert.equal(data.steps.create[0].title, "Harvest");
  assert.equal(data.steps.create[0].actionKind, "HARVEST");
  assert.equal("dryingEstimateMinDays" in data, false);
  assert.equal("dryingEstimateMaxDays" in data, false);
  assert.equal("weatherStatus" in data, false);
});

test("mission list projects operational summary facts without exposing raw constraints", async () => {
  const repository = await readFile("src/features/missions/mission.repository.ts", "utf8");
  for (const field of ["plannedHarvestKg", "destination", "deadlineAt", "approvedPlanName", "fieldBlock"]) assert.match(repository, new RegExp(field));
  assert.match(repository, /constraints: undefined/);
  assert.match(repository, /plans: undefined/);
});

test("mission detail projects operational summary facts from constraints", async () => {
  const repository = await readFile("src/features/missions/mission.repository.ts", "utf8");
  assert.match(repository, /function detailRecord/);
  assert.match(repository, /return value \? detailRecord\(value\) : null/g);
  assert.match(repository, /fieldBlock: \{ select: \{ fieldBlockId: true, name: true \} \}/);
});
