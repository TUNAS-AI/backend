import assert from "node:assert/strict";
import test from "node:test";
import { rainImpact, simulatedRainScenario } from "./tunas.service";

const step = { title: "Panen bawang", stage: "HARVESTING", startsOn: new Date("2026-09-01T00:00:00.000Z"), endsOn: new Date("2026-09-01T00:00:00.000Z"), windowStart: "08:00", windowEnd: "10:00" };

test("matches hard rain only to the affected mission window", () => {
  assert.equal(rainImpact([{ time: "2026-09-01T08:00", precipitation: 0.1, probability: 100 }], [step], "Asia/Jakarta").length, 0);
  assert.equal(rainImpact([{ time: "2026-09-01T07:00", precipitation: 2, probability: 100 }], [step], "Asia/Jakarta").length, 0);
  assert.equal(rainImpact([{ time: "2026-09-01T08:00", precipitation: 0.11, probability: 0 }], [step], "Asia/Jakarta").length, 1);
});

test("builds a future demo forecast around a harvesting step first", () => {
  const drying = { ...step, title: "Keringkan bawang", stage: "DRYING", windowStart: null, windowEnd: null };
  const scenario = simulatedRainScenario([drying, step], "Asia/Jakarta", new Date("2026-08-29T00:00:00.000Z"));
  assert.equal(scenario.step.title, "Panen bawang");
  assert.equal(scenario.date, "2026-09-01");
  assert.equal(scenario.rainStart, "08:00");
  assert.equal(rainImpact(scenario.weather.hourly.time.map((time, index) => ({ time, probability: scenario.weather.hourly.precipitation_probability[index]!, precipitation: scenario.weather.hourly.precipitation[index]! })), [scenario.step], "Asia/Jakarta").length, 1);
});

test("shifts a past demo activity to its next weekday", () => {
  const scenario = simulatedRainScenario([step], "Asia/Jakarta", new Date("2026-09-02T00:00:00.000Z"));
  assert.equal(scenario.date, "2026-09-08");
});
