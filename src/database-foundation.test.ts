import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const schemaPath = resolve("prisma/schema.prisma");
const migrationPath = resolve("prisma/migrations/20260715130000_create_foundation/migration.sql");
const realignmentMigrationPath = resolve("prisma/migrations/20260715140000_realign_shallot_onboarding/migration.sql");
const fieldCoordinatesMigrationPath = resolve("prisma/migrations/20260715150000_replace_field_block_location_with_coordinates/migration.sql");
const cropBatchSimplificationMigrationPath = resolve("prisma/migrations/20260715160000_remove_crop_batch_planning_fields/migration.sql");
const workerWindowRemovalMigrationPath = resolve("prisma/migrations/20260715170000_remove_worker_availability_windows/migration.sql");
const buyerNotesMigrationPath = resolve("prisma/migrations/20260715180000_replace_buyer_constraints_with_notes/migration.sql");
const operationalCapacityRemovalMigrationPath = resolve("prisma/migrations/20260715190000_remove_operational_capacities/migration.sql");
const farmNotesMigrationPath = resolve("prisma/migrations/20260715200000_add_farm_notes/migration.sql");
const requiredFieldCoordinatesMigrationPath = resolve("prisma/migrations/20260715210000_require_field_block_coordinates/migration.sql");
const prismaConfigPath = resolve("prisma.config.ts");

const requiredTables = [
  "users",
  "farms",
  "field_blocks",
  "crop_batches",
  "field_observations",
  "buyer_commitments",
  "weather_snapshots",
];

test("foundation schema maps every application model to its snake_case table", () => {
  const schema = readFileSync(schemaPath, "utf8");

  for (const table of requiredTables) {
    assert.match(schema, new RegExp(`@@map\\(\\"${table}\\"\\)`));
  }

  assert.match(schema, /ownerId\s+String\s+@unique[\s\S]*?@map\(\"owner_id\"\)/);
  assert.match(schema, /onDelete:\s*Cascade/);
  assert.match(schema, /@@index\(/);
});

test("foundation migration creates ownership constraints, indexes, and every required table", () => {
  assert.ok(existsSync(migrationPath), "foundation migration should exist");
  const sql = readFileSync(migrationPath, "utf8");

  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`, "i"));
  }

  assert.match(sql, /owner_id\s+uuid\s+NOT NULL\s+UNIQUE/i);
  assert.match(sql, /REFERENCES public\.users\s*\(id\)\s*ON DELETE CASCADE/i);
  assert.match(sql, /REFERENCES public\.farms\s*\(farm_id\)\s*ON DELETE CASCADE/i);
  assert.match(sql, /CREATE INDEX .*buyer_commitments.*deadline/i);
  assert.match(sql, /CREATE INDEX .*weather_snapshots.*observed_at/i);
});

test("foundation migration provisions public users from Supabase identities securely", () => {
  assert.ok(existsSync(migrationPath), "foundation migration should exist");
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.handle_new_auth_user\(\)/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = public, pg_temp/i);
  assert.match(sql, /INSERT INTO public\.users/i);
  assert.match(sql, /NEW\.id/i);
  assert.match(sql, /NEW\.email/i);
  assert.match(sql, /raw_user_meta_data/i);
  assert.match(sql, /AFTER INSERT ON auth\.users/i);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/i);
  assert.match(sql, /id uuid PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/i);
});

test("foundation preserves farm, field-coordinate, batch, and block-weather context", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const sql = readFileSync(migrationPath, "utf8");
  assert.ok(existsSync(fieldCoordinatesMigrationPath), "field-coordinate migration should exist");
  const fieldCoordinatesSql = readFileSync(fieldCoordinatesMigrationPath, "utf8");

  assert.match(schema, /defaultWorkingHours\s+Json\?/);
  assert.match(schema, /notes\s+String\?\s+@db\.Text/);
  assert.match(schema, /latitude\s+Decimal\s+@db\.Decimal\(9, 6\)/);
  assert.match(schema, /longitude\s+Decimal\s+@db\.Decimal\(9, 6\)/);
  assert.match(schema, /notes\s+String\?/);
  assert.doesNotMatch(schema, /accessNotes\s+String\?/);
  assert.doesNotMatch(schema, /drainageNotes\s+String\?/);
  assert.match(schema, /fieldBlockId\s+String\s+@map\("field_block_id"\)/);
  assert.match(sql, /default_working_hours jsonb/i);
  assert.match(sql, /weather_snapshots[\s\S]*field_block_id uuid NOT NULL/i);
  assert.match(fieldCoordinatesSql, /ADD COLUMN latitude numeric\(9, 6\)/i);
  assert.match(fieldCoordinatesSql, /ADD COLUMN longitude numeric\(9, 6\)/i);
  assert.match(fieldCoordinatesSql, /field_blocks_latitude_check CHECK \(latitude IS NULL OR latitude BETWEEN -90 AND 90\)/i);
  assert.match(fieldCoordinatesSql, /'Access: ' \|\| access_notes/i);
  assert.match(fieldCoordinatesSql, /'Drainage: ' \|\| drainage_notes/i);
  assert.match(fieldCoordinatesSql, /DROP COLUMN location_reference/i);
  assert.match(fieldCoordinatesSql, /DROP COLUMN access_notes/i);
  assert.match(fieldCoordinatesSql, /DROP COLUMN drainage_notes/i);
  assert.ok(existsSync(farmNotesMigrationPath), "farm-notes migration should exist");
  assert.match(readFileSync(farmNotesMigrationPath, "utf8"), /ADD COLUMN notes text/i);
  assert.ok(existsSync(requiredFieldCoordinatesMigrationPath), "required-field-coordinates migration should exist");
  const requiredFieldCoordinatesSql = readFileSync(requiredFieldCoordinatesMigrationPath, "utf8");
  assert.match(requiredFieldCoordinatesSql, /DELETE FROM public\.field_blocks\s+WHERE latitude IS NULL OR longitude IS NULL/i);
  assert.match(requiredFieldCoordinatesSql, /ALTER COLUMN latitude SET NOT NULL/i);
  assert.match(requiredFieldCoordinatesSql, /ALTER COLUMN longitude SET NOT NULL/i);
});

test("foundation prevents cross-farm records and backfills preserved Supabase identities", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /UNIQUE \(farm_id, field_block_id\)/i);
  assert.match(sql, /FOREIGN KEY \(farm_id, field_block_id\) REFERENCES public\.field_blocks \(farm_id, field_block_id\)/i);
  assert.match(sql, /FOREIGN KEY \(farm_id, crop_batch_id\) REFERENCES public\.crop_batches \(farm_id, crop_batch_id\)/i);
  assert.match(sql, /FOREIGN KEY \(farm_id, field_block_id, crop_batch_id\) REFERENCES public\.crop_batches \(farm_id, field_block_id, crop_batch_id\)/i);
  assert.match(sql, /INSERT INTO public\.users \(id, email, display_name\)[\s\S]*?FROM auth\.users/i);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/i);
});

test("foundation represents Supabase auth users without allowing Prisma migrations to manage them", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const prismaConfig = readFileSync(prismaConfigPath, "utf8");

  assert.match(schema, /schemas\s*=\s*\["public",\s*"auth"\]/);
  assert.match(schema, /model AuthUser\s*\{[\s\S]*?@@map\("users"\)[\s\S]*?@@schema\("auth"\)/);
  assert.match(schema, /model User\s*\{[\s\S]*?authUser\s+AuthUser\s+@relation\("AuthUserProfile",\s*fields:\s*\[id\],\s*references:\s*\[id\]/);
  assert.match(prismaConfig, /externalTables:\s*true/);
  assert.match(prismaConfig, /external:\s*\["auth\.users"\]/);
});

test("shallot onboarding realignment retains only the current onboarding data", () => {
  const schema = readFileSync(schemaPath, "utf8");
  assert.ok(existsSync(realignmentMigrationPath), "realignment migration should exist");
  const sql = readFileSync(realignmentMigrationPath, "utf8");
  assert.ok(existsSync(cropBatchSimplificationMigrationPath), "crop-batch simplification migration should exist");
  const cropBatchSimplificationSql = readFileSync(cropBatchSimplificationMigrationPath, "utf8");
  assert.ok(existsSync(workerWindowRemovalMigrationPath), "worker-window removal migration should exist");
  const workerWindowRemovalSql = readFileSync(workerWindowRemovalMigrationPath, "utf8");
  assert.ok(existsSync(buyerNotesMigrationPath), "buyer-notes migration should exist");
  const buyerNotesSql = readFileSync(buyerNotesMigrationPath, "utf8");
  assert.ok(existsSync(operationalCapacityRemovalMigrationPath), "operational-capacity removal migration should exist");
  const operationalCapacityRemovalSql = readFileSync(operationalCapacityRemovalMigrationPath, "utf8");

  assert.match(schema, /defaultWorkerCount\s+Int\s+@default\(1\)\s+@map\("default_worker_count"\)/);
  assert.doesNotMatch(schema, /cropStage\s+String\?/);
  assert.doesNotMatch(schema, /estimatedHarvestReadiness\s+String/);
  assert.doesNotMatch(schema, /harvestRound\s+Int/);
  assert.match(schema, /model FieldObservation/);
  assert.doesNotMatch(schema, /model PostharvestCapacity/);
  assert.doesNotMatch(schema, /model CrateCapacity/);
  assert.doesNotMatch(schema, /model GoogleCalendarConnection/);
  assert.doesNotMatch(schema, /model WorkerAvailabilityWindow/);
  assert.doesNotMatch(schema, /model OperationalCapacity/);
  assert.doesNotMatch(schema, /operationalCapacities\s+OperationalCapacity\[\]/);
  assert.match(schema, /notes\s+String\?\s+@db\.Text/);
  assert.doesNotMatch(schema, /constraints\s+Json/);
  assert.match(sql, /ADD COLUMN default_worker_count integer NOT NULL DEFAULT 1/i);
  assert.match(sql, /ADD COLUMN estimated_harvest_readiness text NOT NULL DEFAULT 'UNSURE'/i);
  assert.match(sql, /CHECK \(default_worker_count > 0\)/i);
  assert.match(sql, /CHECK \(estimated_harvest_readiness IN \('NOT_READY', 'ALMOST_READY', 'READY', 'UNSURE'\)\)/i);
  assert.match(sql, /INSERT INTO public\.operational_capacities[\s\S]*?FROM public\.postharvest_capacities/i);
  assert.match(sql, /'crate:' \|\| crate_type[\s\S]*?FROM public\.crate_capacities/i);
  assert.match(sql, /DROP TABLE public\.postharvest_capacities/i);
  assert.match(sql, /DROP TABLE public\.crate_capacities/i);
  assert.match(sql, /DROP TABLE public\.google_calendar_connections/i);
  assert.match(cropBatchSimplificationSql, /DROP COLUMN crop_stage/i);
  assert.match(cropBatchSimplificationSql, /DROP COLUMN estimated_harvest_readiness/i);
  assert.match(cropBatchSimplificationSql, /DROP COLUMN harvest_round/i);
  assert.match(workerWindowRemovalSql, /DROP TABLE public\.worker_availability_windows/i);
  assert.match(buyerNotesSql, /jsonb_array_elements_text\(constraints\)/i);
  assert.match(buyerNotesSql, /DROP COLUMN constraints/i);
  assert.match(operationalCapacityRemovalSql, /DROP TABLE public\.operational_capacities/i);
});
