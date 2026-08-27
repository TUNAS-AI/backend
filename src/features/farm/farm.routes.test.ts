import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import app from "../../app";

test("protects table-scoped routes and removes the catch-all farm route", async () => {
  const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/farm`)).status, 401);
    assert.equal((await fetch(`${base}/api/field-blocks`)).status, 401);
    assert.equal((await fetch(`${base}/api/crop-batches`)).status, 401);
    assert.equal((await fetch(`${base}/api/onboarding`)).status, 401);
    assert.equal((await fetch(`${base}/api/buyer-commitments`)).status, 401);
    assert.equal((await fetch(`${base}/api/farms`)).status, 404);
  } finally { server.close(); await once(server, "close"); }
});

test("documents explicit table routes and farm notes", async () => {
  const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const document = await (await fetch(`http://127.0.0.1:${address.port}/api/openapi.json`)).json() as { paths: Record<string, unknown>; components: { schemas: { FarmCreateInput: { properties: { notes: { nullable: boolean } } } } } };
    for (const path of ["/api/farm", "/api/onboarding", "/api/field-blocks", "/api/field-blocks/{id}", "/api/crop-batches", "/api/crop-batches/{id}", "/api/buyer-commitments", "/api/buyer-commitments/{id}"]) assert.ok(document.paths[path]);
    assert.equal(document.paths["/api/farms"], undefined);
    assert.equal(document.components.schemas.FarmCreateInput.properties.notes.nullable, true);
  } finally { server.close(); await once(server, "close"); }
});
