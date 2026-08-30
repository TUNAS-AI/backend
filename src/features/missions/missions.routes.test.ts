import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import app from "../../app";

test("protects mission planning routes with bearer authentication", async () => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/missions`)).status, 401);
    assert.equal((await fetch(`${base}/api/missions/calendar?from=2026-07-01&to=2026-07-31`)).status, 401);
    assert.equal((await fetch(`${base}/api/missions/00000000-0000-4000-8000-000000000000`)).status, 401);
    assert.equal((await fetch(`${base}/api/missions/00000000-0000-4000-8000-000000000000`, { method: "DELETE" })).status, 401);
    assert.equal((await fetch(`${base}/api/missions/00000000-0000-4000-8000-000000000000/replan`)).status, 401);
    assert.equal((await fetch(`${base}/api/missions/00000000-0000-4000-8000-000000000000/replan/plan`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/api/tunas/messages`)).status, 401);
    assert.equal((await fetch(`${base}/api/tunas/daily-check`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/api/tunas/missions/00000000-0000-4000-8000-000000000000/reports`)).status, 401);
  } finally {
    server.close();
    await once(server, "close");
  }
});
