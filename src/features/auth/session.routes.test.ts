import assert from "node:assert/strict";
import test from "node:test";
import { sessionPayload } from "./session.routes";

test("returns the verified Supabase identity for the frontend session", () => {
  assert.deepEqual(sessionPayload({
    userId: "user-1",
    authIdentity: { email: "sari@example.com", displayName: "Sari Tani" },
  }), {
    userId: "user-1",
    email: "sari@example.com",
    displayName: "Sari Tani",
  });
});
