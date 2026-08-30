import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("demo seed creates the documented starting state without missions", () => {
  const source = readFileSync(resolve("prisma/seed.ts"), "utf8");
  for (const value of ["Tani Makmur Brebes", "Blok Utara", "Bima Brebes", "650 kg", "Outdoor drying", "rainProtectionAvailable: true"]) assert.match(source, new RegExp(value));
  assert.match(source, /mission\.deleteMany/);
  assert.doesNotMatch(source, /mission\.create/);
});
