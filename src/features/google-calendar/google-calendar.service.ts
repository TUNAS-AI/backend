import { env } from "../../config/env";
import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { decryptCalendarToken, encryptCalendarToken } from "./google-calendar.crypto";
import { googleCalendarAuthorizationUrl, verifyGoogleCalendarState } from "./google-calendar.oauth";
import { GoogleCalendarRepository } from "./google-calendar.repository";

type GoogleTokenResponse = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
type CalendarStep = { planStepId: string; sequence: number; title: string; description: string; scheduleType: string; startsOn: Date; endsOn: Date; windowStart: string | null; windowEnd: string | null; timezone: string; stage: string; targetHarvestKg: unknown; googleCalendarEventId: string | null };
type GoogleCalendarApiError = Error & { status: number; reason: string };

function googleConfiguration() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCalendarRedirectUri) throw new ApiError(503, "Google Calendar is not configured");
  return { clientId: env.googleClientId, clientSecret: env.googleClientSecret, redirectUri: env.googleCalendarRedirectUri };
}
function eventId(planStepId: string) { return `tunas${planStepId.replaceAll("-", "")}`; }
function date(value: Date) { return value.toISOString().slice(0, 10); }
function nextDate(value: Date) { const next = new Date(`${date(value)}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1); return date(next); }
function isGoogleCalendarApiError(error: unknown): error is GoogleCalendarApiError { return error instanceof Error && "status" in error && "reason" in error; }
function syncFailureMessage(error: unknown) {
  if (isGoogleCalendarApiError(error) && error.status === 401) return "Google Calendar authorization expired; reconnect your calendar.";
  if (isGoogleCalendarApiError(error) && error.status === 403) return "Google Calendar denied permission to update your calendar.";
  if (isGoogleCalendarApiError(error) && error.status === 429) return "Google Calendar is busy. Try syncing again shortly.";
  return "Google Calendar could not update a schedule item. Try again.";
}
export function calendarEventBody(missionId: string, step: CalendarStep) {
  const common = { summary: `TUNAS · ${step.title}`, description: `${step.description}\n\nTUNAS mission step. Manage the approved schedule in TUNAS.`, extendedProperties: { private: { tunasMissionId: missionId, tunasPlanStepId: step.planStepId } } };
  if (step.scheduleType === "DAILY_WINDOW" && step.windowStart && step.windowEnd) return { ...common, start: { dateTime: `${date(step.startsOn)}T${step.windowStart}:00`, timeZone: step.timezone }, end: { dateTime: `${date(step.endsOn)}T${step.windowEnd}:00`, timeZone: step.timezone } };
  return { ...common, start: { date: date(step.startsOn) }, end: { date: nextDate(step.endsOn) } };
}

export class GoogleCalendarService {
  constructor(private readonly repository = new GoogleCalendarRepository()) {}

  async status(ownerId: string) {
    const connection = await this.repository.connection(await callerFarmId(ownerId));
    return { connected: Boolean(connection), calendarName: connection ? "Primary Google Calendar" : null };
  }

  async connect(ownerId: string) {
    return { authorizationUrl: googleCalendarAuthorizationUrl(await callerFarmId(ownerId)) };
  }

  async complete(query: { code?: unknown; state?: unknown }) {
    const state = verifyGoogleCalendarState(typeof query.state === "string" ? query.state : undefined);
    if (typeof query.code !== "string") throw new ApiError(400, "Google Calendar did not return an authorization code");
    const token = await this.exchangeCode(query.code);
    if (!token.accessToken || !token.refreshToken) throw new ApiError(503, "Google Calendar did not return reusable access credentials");
    await this.repository.saveConnection({ farmId: state.farmId, encryptedAccessToken: encryptCalendarToken(token.accessToken), encryptedRefreshToken: encryptCalendarToken(token.refreshToken), tokenExpiresAt: token.expiresAt, scopes: token.scope });
    await this.syncFarm(state.farmId);
  }

  async disconnect(ownerId: string) {
    const farmId = await callerFarmId(ownerId);
    const result = await this.removeRecordedEvents(farmId);
    await this.repository.disconnect(farmId);
    return { connected: false, ...result };
  }

  async removeMissionEvents(farmId: string, missionId: string) { return this.removeRecordedEvents(farmId, missionId); }

  async removeFarmEvents(farmId: string) { return this.removeRecordedEvents(farmId); }

  async sync(ownerId: string) { return this.syncFarm(await callerFarmId(ownerId)); }

  async syncIfConnected(farmId: string) {
    if (!await this.repository.connection(farmId)) return null;
    return this.syncFarm(farmId);
  }

  private async removeRecordedEvents(farmId: string, missionId?: string) {
    const events = await this.repository.syncedEvents(farmId, missionId);
    const connection = await this.repository.connection(farmId);
    if (!events.length || !connection) return { removed: 0, failed: 0 };
    let accessToken: string;
    try { accessToken = await this.accessToken(farmId, connection); } catch (error) {
      this.logSyncFailure("delete", error);
      return { removed: 0, failed: events.length, failureReason: syncFailureMessage(error) };
    }
    let removed = 0; let failed = 0; let failureReason: string | undefined;
    for (const event of events) {
      try {
        await this.deleteEvent(accessToken, connection.calendarId, event.googleCalendarEventId as string);
        await this.repository.clearSynced(event.planStepId, event.plan.missionId);
        removed += 1;
      } catch (error) {
        failed += 1; failureReason ??= syncFailureMessage(error); this.logSyncFailure("delete", error);
      }
    }
    return { removed, failed, ...(failureReason ? { failureReason } : {}) };
  }

  async syncFarm(farmId: string) {
    const connection = await this.repository.connection(farmId);
    if (!connection) throw new ApiError(409, "Google Calendar is not connected");
    const accessToken = await this.accessToken(farmId, connection);
    const missions = await this.repository.approvedActiveMissions(farmId);
    let synced = 0; let failed = 0; let failureReason: string | undefined;
    for (const mission of missions) {
      const approved = mission.plans.find((plan) => plan.planId === mission.approvedPlanId);
      if (!approved) continue;
      const retired = mission.plans.filter((plan) => plan.planId !== approved.planId).flatMap((plan) => plan.steps).filter((step) => step.googleCalendarEventId);
      for (const step of retired) {
        try { await this.deleteEvent(accessToken, connection.calendarId, step.googleCalendarEventId as string); await this.repository.clearSynced(step.planStepId, mission.missionId); } catch (error) { await this.repository.markFailed(step.planStepId, mission.missionId); failed += 1; failureReason ??= syncFailureMessage(error); this.logSyncFailure("delete", error); }
      }
      for (const step of approved.steps) {
        try { const id = eventId(step.planStepId); await this.syncEvent(accessToken, connection.calendarId, id, calendarEventBody(mission.missionId, step), Boolean(step.googleCalendarEventId)); await this.repository.markSynced(step.planStepId, mission.missionId, id); synced += 1; } catch (error) { await this.repository.markFailed(step.planStepId, mission.missionId); failed += 1; failureReason ??= syncFailureMessage(error); this.logSyncFailure("write", error); }
      }
    }
    return { synced, failed, ...(failureReason ? { failureReason } : {}) };
  }

  private async exchangeCode(code: string) {
    const config = googleConfiguration(); const body = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
    if (!response.ok || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") throw new ApiError(503, "Google Calendar authorization failed");
    return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: new Date(Date.now() + (typeof payload.expires_in === "number" ? payload.expires_in : 3600) * 1000), scope: typeof payload.scope === "string" ? payload.scope : "https://www.googleapis.com/auth/calendar.events" };
  }

  private async accessToken(farmId: string, connection: Awaited<ReturnType<GoogleCalendarRepository["connection"]>> extends infer Connection ? Exclude<Connection, null> : never) {
    if (connection.tokenExpiresAt.getTime() > Date.now() + 60_000) return decryptCalendarToken(connection.encryptedAccessToken);
    const config = googleConfiguration(); const refreshToken = decryptCalendarToken(connection.encryptedRefreshToken);
    const body = new URLSearchParams({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
    if (!response.ok || typeof payload.access_token !== "string") throw new ApiError(503, "Google Calendar authorization expired; reconnect your calendar");
    await this.repository.updateToken(farmId, { encryptedAccessToken: encryptCalendarToken(payload.access_token), tokenExpiresAt: new Date(Date.now() + (typeof payload.expires_in === "number" ? payload.expires_in : 3600) * 1000) });
    return payload.access_token;
  }

  private async syncEvent(accessToken: string, calendarId: string, id: string, body: object, alreadySynced: boolean) {
    if (!alreadySynced) {
      try { return await this.createEvent(accessToken, calendarId, id, body); } catch (error) { if (!isGoogleCalendarApiError(error) || error.status !== 409) throw error; }
      return this.putEvent(accessToken, calendarId, id, body);
    }
    try { return await this.putEvent(accessToken, calendarId, id, body); } catch (error) { if (!isGoogleCalendarApiError(error) || error.status !== 404) throw error; }
    return this.createEvent(accessToken, calendarId, id, body);
  }

  private async createEvent(accessToken: string, calendarId: string, id: string, body: object) {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id }) });
    if (!response.ok) throw await this.googleCalendarError(response);
  }

  private async putEvent(accessToken: string, calendarId: string, id: string, body: object) {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw await this.googleCalendarError(response);
  }

  private async deleteEvent(accessToken: string, calendarId: string, id: string) {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok && response.status !== 404) throw await this.googleCalendarError(response);
  }

  private async googleCalendarError(response: Response): Promise<GoogleCalendarApiError> {
    const payload = await response.json().catch(() => ({})) as { error?: { errors?: Array<{ reason?: unknown }> } };
    const reason = typeof payload.error?.errors?.[0]?.reason === "string" ? payload.error.errors[0].reason : "unknown";
    return Object.assign(new Error("Google Calendar request failed"), { status: response.status, reason });
  }

  private logSyncFailure(operation: "write" | "delete", error: unknown) {
    if (isGoogleCalendarApiError(error)) console.warn("Google Calendar sync request failed", { operation, status: error.status, reason: error.reason });
    else console.warn("Google Calendar sync request failed", { operation, reason: "network_error" });
  }
}
