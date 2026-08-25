import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import app from "./app";

test("serves the root service endpoint", async () => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: "hijau-ai-backend" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("keeps the account API behind bearer authentication", async () => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/session`);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "A Supabase bearer token is required" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
