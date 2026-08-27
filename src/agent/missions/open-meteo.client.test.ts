import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenMeteoForecast } from "./open-meteo.client";

test("rejects malformed Open-Meteo forecast payloads", () => {
  assert.throws(() => parseOpenMeteoForecast({ hourly: { time: "not-an-array" } }), /temporarily unavailable/);
  assert.deepEqual(parseOpenMeteoForecast({ hourly: { time: ["2026-07-15T00:00"] } }), { hourly: { time: ["2026-07-15T00:00"] } });
});
