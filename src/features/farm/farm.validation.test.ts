import assert from "node:assert/strict";
import test from "node:test";
import { parseFarm } from "./farm.validation";

test("accepts nullable farm notes on create and update", () => {
  assert.equal(parseFarm({ name: "Kebun Cisarua", defaultWorkerCount: 4, notes: "Near the village road." }, true).notes, "Near the village road.");
  assert.equal(parseFarm({ notes: null }, false).notes, null);
});

test("accepts three-state rain protection and rejects other values", () => {
  assert.equal(parseFarm({ rainProtectionAvailable: true }, false).rainProtectionAvailable, true);
  assert.equal(parseFarm({ rainProtectionAvailable: null }, false).rainProtectionAvailable, null);
  assert.throws(() => parseFarm({ rainProtectionAvailable: "yes" }, false), /boolean or null/);
});

test("rejects protected drying capacity above total capacity", () => {
  assert.throws(() => parseFarm({ dryingProfile: { method: "FIELD_SUN", capacityKg: 100, protectedCapacityKg: 101, minDays: 3, maxDays: 5 } }, false), /must not exceed capacityKg/);
});

test("rejects overlapping default work windows", () => {
  assert.throws(
    () => parseFarm({
      name: "Kebun Cisarua",
      defaultWorkerCount: 4,
      defaultWorkingHours: { monday: [{ start: "06:00", end: "10:00" }, { start: "09:00", end: "12:00" }] },
    }, true),
    (error: unknown) => error instanceof Error && error.message === "defaultWorkingHours.monday ranges must not overlap",
  );
});

test("accepts positive whole scheduling durations", () => {
  const durations = { readinessCheckMinutes: 15, harvestMinutes: 360, transferToDryingMinutes: 30, beginDryingMinutes: 15, dryingInspectionMinutes: 30 };
  assert.deepEqual(parseFarm({ schedulingDurations: durations }, false).schedulingDurations, durations);
  assert.throws(() => parseFarm({ schedulingDurations: { ...durations, harvestMinutes: 1.5 } }, false), /schedulingDurations.harvestMinutes/);
});
