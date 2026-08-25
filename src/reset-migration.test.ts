import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationPath = resolve("prisma/migrations/20260715120000_reset_legacy_hijau_application/migration.sql");

test("reset migration only removes named legacy public objects", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.doesNotMatch(sql, /DROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?public/i);
  assert.doesNotMatch(sql, /auth\./i);
  assert.match(sql, /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.missions\s+CASCADE;/i);
  assert.match(sql, /DROP\s+TYPE\s+IF\s+EXISTS\s+public\.mission_status\s+CASCADE;/i);
});
