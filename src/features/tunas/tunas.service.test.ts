import assert from "node:assert/strict";
import test from "node:test";
import { rainImpact } from "./tunas.service";

const step = { title: "Panen bawang", stage: "HARVESTING", startsOn: new Date("2026-09-01T00:00:00.000Z"), endsOn: new Date("2026-09-01T00:00:00.000Z"), windowStart: "08:00", windowEnd: "10:00" };

test("matches hard rain only to the affected mission window", () => {
  assert.equal(rainImpact([{ time: "2026-09-01T08:00", precipitation: 0.1, probability: 100 }], [step], "Asia/Jakarta").length, 0);
  assert.equal(rainImpact([{ time: "2026-09-01T07:00", precipitation: 2, probability: 100 }], [step], "Asia/Jakarta").length, 0);
  assert.equal(rainImpact([{ time: "2026-09-01T08:00", precipitation: 0.11, probability: 0 }], [step], "Asia/Jakarta").length, 1);
});
