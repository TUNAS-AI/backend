import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { ApiError } from "../../shared/api-error";

const ttlMs = 10 * 60 * 1000;
type OAuthState = { farmId: string; exp: number };

function secret() {
  if (!env.googleOauthStateSecret) throw new ApiError(503, "Google Calendar is not configured");
  return env.googleOauthStateSecret;
}
function sign(body: string) { return createHmac("sha256", secret()).update(body).digest("base64url"); }

export function googleCalendarAuthorizationUrl(farmId: string) {
  if (!env.googleClientId || !env.googleCalendarRedirectUri) throw new ApiError(503, "Google Calendar is not configured");
  const body = Buffer.from(JSON.stringify({ farmId, exp: Date.now() + ttlMs } satisfies OAuthState)).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.googleClientId);
  url.searchParams.set("redirect_uri", env.googleCalendarRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", `${body}.${sign(body)}`);
  return url.toString();
}

export function verifyGoogleCalendarState(value: string | undefined): OAuthState {
  const [body, received, extra] = value?.split(".") ?? [];
  if (!body || !received || extra) throw new ApiError(400, "Google Calendar connection state is invalid");
  const expected = Buffer.from(sign(body)); const signature = Buffer.from(received);
  if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) throw new ApiError(400, "Google Calendar connection state is invalid");
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (!state.farmId || !Number.isFinite(state.exp) || state.exp < Date.now()) throw new Error();
    return state;
  } catch { throw new ApiError(400, "Google Calendar connection state is invalid"); }
}
