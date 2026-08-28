import assert from "node:assert/strict";
import test from "node:test";
import { missionConfirmationTransactionOptions, planCreateData } from "./mission.repository";

test("allows confirmation writes enough time to commit on the hosted database", () => {
  assert.deepEqual(missionConfirmationTransactionOptions, { timeout: 15_000 });
});

test("keeps each generated activity nested under its own plan", () => {
  const data = planCreateData("mission", "run", {
    name: "Early harvest", summary: "Before rain", recommended: true, assumptions: ["Drying estimate"], risks: {}, dryingEstimateDays: 4, dryingEstimateReason: "Traditional drying estimate.",
    activities: [{ title: "Harvest", description: "Pick", scheduleType: "DAILY_WINDOW", startsOn: "2026-07-15", endsOn: "2026-07-15", windowStart: "08:00", windowEnd: "10:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" }],
  });
  assert.equal(data.name, "Early harvest");
  assert.equal(data.steps.create[0].title, "Harvest");
});
