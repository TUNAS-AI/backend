import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

test("loads the app without database configuration", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "";

  try {
    const { default: app } = await import("./app");
    assert.ok(app);
    const server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
      assert.equal(response.status, 503);
    } finally {
      server.close();
      await once(server, "close");
    }
  } finally {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});
