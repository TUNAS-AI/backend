import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../shared/api-error";
import { parseFieldBlock } from "./field-block.validation";

test("field-block updates reject null or incomplete coordinates", () => {
  assert.throws(() => parseFieldBlock({ coordinates: null }, false), (error: unknown) => error instanceof ApiError && error.message === "coordinates must be a JSON object");
  assert.throws(() => parseFieldBlock({ coordinates: { latitude: -6.9 } }, false), (error: unknown) => error instanceof ApiError && error.message.includes("coordinates.longitude"));
});

test("field-block creation normalizes nested coordinates for persistence", () => {
  assert.deepEqual(parseFieldBlock({ name: "North Block", coordinates: { latitude: -6.9, longitude: 107.6 } }, true), {
    name: "North Block",
    latitude: -6.9,
    longitude: 107.6,
  });
});
