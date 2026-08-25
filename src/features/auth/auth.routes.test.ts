import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import app from "../../app";
import { env } from "../../config/env";

test("starts Google sign-in through the public auth endpoint", async () => {
  const configuredSupabaseUrl = env.supabaseUrl;
  const configuredFrontendUrl = env.frontendUrl;
  env.supabaseUrl = "https://example.supabase.co";
  env.frontendUrl = "http://localhost:5173";

  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/google`, {
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.pathname, "/auth/v1/authorize");
    assert.equal(location.searchParams.get("provider"), "google");
    assert.equal(location.searchParams.get("redirect_to"), "http://localhost:5173/auth/callback");
  } finally {
    env.supabaseUrl = configuredSupabaseUrl;
    env.frontendUrl = configuredFrontendUrl;
    server.close();
    await once(server, "close");
  }
});

test("keeps Swagger Google sign-in on its local token-handoff callback", async () => {
  const configuredSupabaseUrl = env.supabaseUrl;
  env.supabaseUrl = "https://example.supabase.co";

  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/google/swagger`, {
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.searchParams.get("redirect_to"), "http://localhost:3000/api/auth/google/callback");
  } finally {
    env.supabaseUrl = configuredSupabaseUrl;
    server.close();
    await once(server, "close");
  }
});

test("reports unavailable Google sign-in configuration without redirecting", async () => {
  const configuredSupabaseUrl = env.supabaseUrl;
  env.supabaseUrl = null;

  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/google`, {
      redirect: "manual",
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Google sign-in is not configured" });
  } finally {
    env.supabaseUrl = configuredSupabaseUrl;
    server.close();
    await once(server, "close");
  }
});

test("publishes an OpenAPI document for Google sign-in and bearer session testing", async () => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/openapi.json`);

    assert.equal(response.status, 200);
    const document = await response.json() as {
      components: { securitySchemes: { bearerAuth: unknown } };
      paths: Record<string, unknown>;
    };

    assert.deepEqual(document.components.securitySchemes.bearerAuth, {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
    assert.ok(document.paths["/api/auth/google"]);
    assert.ok(document.paths["/api/auth/google/swagger"]);
    assert.ok(document.paths["/api/session"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("serves a callback page that hands the fragment token to Swagger session storage", async () => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/google/callback`);

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /sessionStorage\.setItem\("hijau\.swagger\.bearer", token\)/);
    assert.match(body, /history\.replaceState/);
    assert.match(body, /window\.location\.assign\("\/api-docs"\)/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Swagger UI consumes the one-time callback token and offers a Google sign-in link", async () => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api-docs/`);

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /sessionStorage\.getItem\(tokenKey\)/);
    assert.match(body, /preauthorizeApiKey\("bearerAuth", token\)/);
    assert.match(body, /sessionStorage\.removeItem\(tokenKey\)/);
    assert.match(body, /href = "\/api\/auth\/google\/swagger"/);
  } finally {
    server.close();
    await once(server, "close");
  }
});
