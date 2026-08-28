import assert from "node:assert/strict";
import test from "node:test";
import { chooseDemoMission } from "./tunas.service";

test("selects one eligible mission for a Tunas demo", () => {
  assert.equal(chooseDemoMission(["first", "second", "third"], () => 0.5), "second");
  assert.equal(chooseDemoMission([], () => 0), null);
});
