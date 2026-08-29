import assert from "node:assert/strict";
import test from "node:test";
import { FarmStructureDeletionService } from "./farm-structure-deletion.service";

test("deletes a field's linked missions after cleaning their calendar events", async () => {
  const cleaned: string[] = [];
  const deleted: Array<[string, string]> = [];
  const service = new FarmStructureDeletionService(
    {
      async missionIdsForFieldBlock() { return ["mission-1", "mission-2"]; },
      async missionIdsForCropBatch() { return []; },
      async deleteFieldBlock(farmId: string, fieldBlockId: string) { deleted.push([farmId, fieldBlockId]); },
      async deleteCropBatch() {},
    },
    { async removeMissionEvents(_farmId: string, missionId: string) { cleaned.push(missionId); return { removed: 0, failed: 0 }; } },
  );

  await service.deleteFieldBlock("farm-1", "field-1");

  assert.deepEqual(cleaned, ["mission-1", "mission-2"]);
  assert.deepEqual(deleted, [["farm-1", "field-1"]]);
});

test("deletes a crop batch's linked missions after cleaning their calendar events", async () => {
  const cleaned: string[] = [];
  const deleted: Array<[string, string]> = [];
  const service = new FarmStructureDeletionService(
    {
      async missionIdsForFieldBlock() { return []; },
      async missionIdsForCropBatch() { return ["mission-1"]; },
      async deleteFieldBlock() {},
      async deleteCropBatch(farmId: string, cropBatchId: string) { deleted.push([farmId, cropBatchId]); },
    },
    { async removeMissionEvents(_farmId: string, missionId: string) { cleaned.push(missionId); return { removed: 0, failed: 0 }; } },
  );

  await service.deleteCropBatch("farm-1", "batch-1");

  assert.deepEqual(cleaned, ["mission-1"]);
  assert.deepEqual(deleted, [["farm-1", "batch-1"]]);
});
