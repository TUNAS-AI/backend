import assert from "node:assert/strict";
import test from "node:test";
import { serializeRecord } from "./record-serializer";

test("serializes mission schedule dates as date-only values", () => {
  const serialized = serializeRecord({
    missionSteps: [{ startsOn: new Date("2026-07-20T00:00:00.000Z"), endsOn: new Date("2026-07-22T00:00:00.000Z") }],
  }) as { missionSteps: Array<{ startsOn: string; endsOn: string }> };

  assert.deepEqual(serialized.missionSteps[0], { startsOn: "2026-07-20", endsOn: "2026-07-22" });
});
