import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("mission migration persists approval-ready plans and calendar projections", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const sql = readFileSync(resolve("prisma/migrations/20260715211000_add_mission_planning/migration.sql"), "utf8");
  const cropBatchSql = readFileSync(resolve("prisma/migrations/20260715212000_add_mission_crop_batches/migration.sql"), "utf8");
  for (const table of ["missions", "mission_messages", "mission_clarifications", "mission_constraints", "planning_runs", "plans", "plan_steps", "mission_steps"]) {
    assert.match(schema, new RegExp(`@@map\\(\\"${table}\\"\\)`));
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`, "i"));
  }
  assert.match(sql, /calendar_sync_status text NOT NULL DEFAULT 'NOT_REQUESTED'/i);
  assert.match(sql, /google_calendar_event_id text/i);
  assert.match(sql, /status text NOT NULL DEFAULT 'SCHEDULED'/i);
  const planStepModel = schema.match(/model PlanStep \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(planStepModel, /calendarSyncStatus\s+String\s+@default\("NOT_REQUESTED"\)/);
  assert.match(schema, /fieldBlockId\s+String\?\s+@map\("field_block_id"\)/);
  assert.match(schema, /model MissionCropBatch/);
  assert.match(sql, /FOREIGN KEY \(farm_id, field_block_id\) REFERENCES public\.field_blocks\s*\(farm_id, field_block_id\)/i);
  assert.match(cropBatchSql, /CREATE TABLE public\.mission_crop_batches/i);
  assert.match(cropBatchSql, /FOREIGN KEY \(farm_id, crop_batch_id\) REFERENCES public\.crop_batches\s*\(farm_id, crop_batch_id\)/i);
});

test("active lifecycle schema persists stages, fact provenance, and closeout metrics", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const sql = readFileSync(resolve("prisma/migrations/20260716110000_add_active_mission_lifecycle/migration.sql"), "utf8");
  const removalSql = readFileSync(resolve("prisma/migrations/20260717120000_remove_buyer_commitments/migration.sql"), "utf8");
  assert.match(schema, /stage\s+String\s+@default\("WAITING"\)/);
  assert.doesNotMatch(schema, /buyerTargetMet\s+Boolean/);
  assert.match(schema, /dryingCompleted\s+Boolean/);
  assert.match(schema, /model MissionCloseout/);
  assert.match(schema, /plannedHarvestKg/);
  assert.match(schema, /provenance\s+String/);
  assert.match(sql, /CREATE TABLE public\.mission_closeouts/i);
  assert.match(sql, /ADD COLUMN stage text/i);
  assert.match(removalSql, /DROP COLUMN IF EXISTS buyer_commitment_id/i);
  assert.match(removalSql, /DROP COLUMN IF EXISTS buyer_target_met/i);
  assert.match(removalSql, /DROP TABLE IF EXISTS public\.buyer_commitments/i);
});

test("happy-path lifecycle constrains mission and step states", () => {
  const sql = readFileSync(resolve("prisma/migrations/20260716130000_enforce_mission_happy_path/migration.sql"), "utf8");
  assert.match(sql, /'ACTIVE', 'CLOSEOUT', 'COMPLETED'/);
  assert.match(sql, /'WAITING', 'HARVESTING', 'DRYING', 'FINISHED', 'TO_REVIEW', 'COMPLETED'/);
  assert.match(sql, /'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'/);
});

test("range-based schedules and drying estimates are persisted", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const sql = readFileSync(resolve("prisma/migrations/20260716140000_add_range_based_mission_schedules/migration.sql"), "utf8");
  assert.match(schema, /dryingEstimateDays/);
  assert.match(schema, /scheduleType/);
  assert.match(schema, /startsOn/);
  assert.match(sql, /RENAME COLUMN start_at TO starts_on/i);
  assert.match(sql, /schedule_type_check/i);
});

test("scheduled harvest allocations are persisted for complete split plans", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const sql = readFileSync(resolve("prisma/migrations/20260716150000_add_harvest_targets_to_schedule_steps/migration.sql"), "utf8");
  assert.match(schema, /targetHarvestKg/);
  assert.match(sql, /plan_steps ADD COLUMN target_harvest_kg/i);
  assert.match(sql, /mission_steps ADD COLUMN target_harvest_kg/i);
});
