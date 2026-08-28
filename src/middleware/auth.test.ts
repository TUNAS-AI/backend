import assert from "node:assert/strict";
import test from "node:test";
import { authIdentityFromClaims } from "./auth";

test("extracts an authenticated identity only from verified JWT claims", () => {
  assert.deepEqual(authIdentityFromClaims({ sub: "user-1", email: "sari@example.com", user_metadata: { full_name: "Sari Tani" } }), {
    userId: "user-1", email: "sari@example.com", displayName: "Sari Tani",
  });
  assert.equal(authIdentityFromClaims({ email: "sari@example.com" }), null);
});
