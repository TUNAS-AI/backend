import assert from "node:assert/strict";
import test from "node:test";
import { parseCropBatch } from "./crop-batch.validation";

test("requires canonical readiness for new crop batches", () => {
  const fieldBlockId = "00000000-0000-4000-8000-000000000001";
  assert.equal(parseCropBatch({ fieldBlockId, readinessStatus: "READY" }, true).readinessStatus, "READY");
  assert.equal(parseCropBatch({ readinessStatus: "NOT_READY" }, false).readinessStatus, "NOT_READY");
  assert.throws(() => parseCropBatch({ fieldBlockId }, true), /readinessStatus is required/);
  assert.throws(() => parseCropBatch({ readinessStatus: "UNSURE" }, false), /READY or NOT_READY/);
});
