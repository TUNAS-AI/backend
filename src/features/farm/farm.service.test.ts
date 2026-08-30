import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { FarmService } from "./farm.service";

function repository(deleted: string[]) {
  return {
    async findByOwner() { return { farmId: "farm-1" }; },
    async snapshot() { return null; },
    async create() { return {} as never; },
    async update() { return {} as never; },
    async delete(farmId: string) { deleted.push(farmId); },
  };
}

test("cleans farm calendar events before deleting local farm data", async () => {
  const calls: string[] = [];
  const service = new FarmService(repository(calls), { async removeFarmEvents(farmId: string) { calls.push(`calendar:${farmId}`); return { removed: 1, failed: 0 }; } });

  await service.delete("owner-1", { confirmation: "DELETE_FARM" });

  assert.deepEqual(calls, ["calendar:farm-1", "farm-1"]);
});

test("calendar cleanup failure does not block local farm deletion", async () => {
  const deleted: string[] = [];
  const warnings: unknown[][] = [];
  const previousWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const service = new FarmService(repository(deleted), { async removeFarmEvents() { throw new Error("offline"); } });
    await service.delete("owner-1", { confirmation: "DELETE_FARM" });
  } finally {
    console.warn = previousWarn;
  }

  assert.deepEqual(deleted, ["farm-1"]);
  assert.deepEqual(warnings, [["Google Calendar cleanup failed during farm deletion", { farmId: "farm-1", kind: "Error" }]]);
});

test("deletes missions before the farm inside one transaction", () => {
  const source = readFileSync(resolve("src/features/farm/farm.repository.ts"), "utf8");
  assert.match(source, /\$transaction\(async \(tx\)[\s\S]*tx\.mission\.deleteMany\(\{ where: \{ farmId \} \}\)[\s\S]*tx\.farm\.delete\(\{ where: \{ farmId \} \}\)/);
});
