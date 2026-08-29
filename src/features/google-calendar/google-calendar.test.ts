import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../../config/env";
import { decryptCalendarToken, encryptCalendarToken } from "./google-calendar.crypto";
import { googleCalendarAuthorizationUrl, verifyGoogleCalendarState } from "./google-calendar.oauth";
import { calendarEventBody } from "./google-calendar.service";
import { readFile } from "node:fs/promises";

test("protects stored Google Calendar tokens with authenticated encryption", () => {
  const previous = env.appEncryptionKey; env.appEncryptionKey = "test-calendar-encryption-key";
  try { const encrypted = encryptCalendarToken("refresh-token"); assert.notEqual(encrypted, "refresh-token"); assert.equal(decryptCalendarToken(encrypted), "refresh-token"); } finally { env.appEncryptionKey = previous; }
});

test("signs the Google Calendar OAuth state and requests event-only access", () => {
  const previous = { clientId: env.googleClientId, redirectUri: env.googleCalendarRedirectUri, stateSecret: env.googleOauthStateSecret };
  env.googleClientId = "client"; env.googleCalendarRedirectUri = "http://localhost:3000/api/google-calendar/callback"; env.googleOauthStateSecret = "state-secret";
  try { const url = new URL(googleCalendarAuthorizationUrl("00000000-0000-4000-8000-000000000001")); assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events"); assert.equal(verifyGoogleCalendarState(url.searchParams.get("state") ?? "").farmId, "00000000-0000-4000-8000-000000000001"); } finally { env.googleClientId = previous.clientId; env.googleCalendarRedirectUri = previous.redirectUri; env.googleOauthStateSecret = previous.stateSecret; }
});

test("maps drying ranges to Google all-day events with an exclusive end date", () => {
  const event = calendarEventBody("mission-1", { planStepId: "00000000-0000-4000-8000-000000000001", sequence: 1, title: "Dry shallots", description: "Keep covered.", scheduleType: "DATE_RANGE", startsOn: new Date("2026-07-20T00:00:00.000Z"), endsOn: new Date("2026-07-22T00:00:00.000Z"), windowStart: null, windowEnd: null, timezone: "Asia/Jakarta", stage: "DRYING", targetHarvestKg: null, googleCalendarEventId: null });
  assert.deepEqual(event, { summary: "TUNAS · Dry shallots", description: "Keep covered.\n\nTUNAS mission step. Manage the approved schedule in TUNAS.", extendedProperties: { private: { tunasMissionId: "mission-1", tunasPlanStepId: "00000000-0000-4000-8000-000000000001" } }, start: { date: "2026-07-20" }, end: { date: "2026-07-23" } });
});

test("creates unsynced Calendar events before updating existing ones", async () => {
  const service = await readFile("src/features/google-calendar/google-calendar.service.ts", "utf8");
  assert.match(service, /method: "POST"/);
  assert.match(service, /JSON\.stringify\(\{ \.\.\.body, id \}\)/);
  assert.match(service, /alreadySynced/);
  assert.match(service, /error\.status !== 404/);
});

test("cleans up only saved TUNAS event IDs and skips missing Google events", async () => {
  const service = await readFile("src/features/google-calendar/google-calendar.service.ts", "utf8");
  const repository = await readFile("src/features/google-calendar/google-calendar.repository.ts", "utf8");
  assert.match(service, /removeMissionEvents\(farmId: string, missionId: string\)/);
  assert.match(service, /this\.repository\.syncedEvents\(farmId, missionId\)/);
  assert.match(service, /response\.status !== 404/);
  assert.match(repository, /googleCalendarEventId: \{ not: null \}/);
  assert.match(repository, /missionId \? \{ missionId \} : \{\}/);
});
