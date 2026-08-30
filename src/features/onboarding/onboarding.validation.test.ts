import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../shared/api-error";
import { OnboardingRepository, type OnboardingDatabase } from "./onboarding.repository";
import { parseOnboarding } from "./onboarding.validation";

const validPayload = {
  farm: {
    name: "Kebun Cisarua",
    defaultWorkerCount: 3,
    defaultWorkingHours: { monday: [{ start: "06:00", end: "11:00" }] },
  },
  fields: [{
    name: "North Block",
    coordinates: { latitude: -6.914744, longitude: 107.60981 },
    cropBatches: [{ variety: "Bima Brebes", plantingDate: "2026-05-15", readinessStatus: "READY" }],
  }],
};

test("parses an atomic farm onboarding payload", () => {
  const parsed = parseOnboarding(validPayload);

  assert.equal(parsed.farm.name, "Kebun Cisarua");
  assert.equal(parsed.fields[0].latitude, -6.914744);
  assert.equal(parsed.fields[0].cropBatches[0].variety, "Bima Brebes");
  assert.equal(parsed.fields[0].cropBatches[0].readinessStatus, "READY");
});

test("rejects onboarding without a crop batch for every field", () => {
  assert.throws(
    () => parseOnboarding({ ...validPayload, fields: [{ ...validPayload.fields[0], cropBatches: [] }] }),
    (error: unknown) => error instanceof ApiError && error.message === "fields[0].cropBatches must include at least one crop batch",
  );
});

test("rejects incomplete farm and field input", () => {
  for (const payload of [
    { ...validPayload, farm: { ...validPayload.farm, defaultWorkerCount: 0 } },
    { ...validPayload, fields: [] },
    { ...validPayload, fields: [{ ...validPayload.fields[0], coordinates: { latitude: -6.914744 } }] },
    { ...validPayload, fields: [{ ...validPayload.fields[0], coordinates: { latitude: 91, longitude: 107.60981 } }] },
  ]) {
    assert.throws(() => parseOnboarding(payload), ApiError);
  }
});

type FarmRow = { farmId: string; ownerId: string };

function inMemoryDatabase({ failCropCreation = false }: { failCropCreation?: boolean } = {}) {
  const committed = { farms: [] as FarmRow[], fields: [] as string[], batches: [] as string[] };
  const database = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const staged = { farms: [...committed.farms], fields: [...committed.fields], batches: [...committed.batches] };
      const transaction = {
        farm: {
          findUnique: async ({ where }: { where: { ownerId: string } }) => staged.farms.find((farm) => farm.ownerId === where.ownerId) ?? null,
          create: async ({ data }: { data: { ownerId: string } }) => {
            const farm = { farmId: `farm-${staged.farms.length + 1}`, ownerId: data.ownerId };
            staged.farms.push(farm);
            return farm;
          },
        },
        fieldBlock: { create: async () => { const fieldBlockId = `field-${staged.fields.length + 1}`; staged.fields.push(fieldBlockId); return { fieldBlockId }; } },
        cropBatch: { createMany: async () => { if (failCropCreation) throw new Error("crop batch write failed"); staged.batches.push("batch"); } },
      };
      const result = await callback(transaction);
      committed.farms = staged.farms;
      committed.fields = staged.fields;
      committed.batches = staged.batches;
      return result;
    },
  } as unknown as OnboardingDatabase;
  return { database, committed };
}

test("rejects duplicate farms and rolls back nested writes", async () => {
  const input = parseOnboarding(validPayload);
  const duplicate = inMemoryDatabase();
  duplicate.committed.farms.push({ farmId: "farm-existing", ownerId: "owner-1" });
  await assert.rejects(() => new OnboardingRepository(duplicate.database).create("owner-1", input), (error: unknown) => error instanceof ApiError && error.status === 409);

  const failing = inMemoryDatabase({ failCropCreation: true });
  await assert.rejects(() => new OnboardingRepository(failing.database).create("owner-1", input), /crop batch write failed/);
  assert.deepEqual(failing.committed, { farms: [], fields: [], batches: [] });
});
