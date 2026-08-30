import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:5173").trim().replace(/\/$/, "");
const googleCalendarRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || null;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
const ngrokAuthToken = process.env.NGROK_AUTHTOKEN?.trim() || null;
const ngrokDomainValue = process.env.NGROK_DOMAIN?.trim().replace(/\/$/, "") || null;
const ngrokDomain = ngrokDomainValue ? (/^https?:\/\//i.test(ngrokDomainValue) ? ngrokDomainValue : `https://${ngrokDomainValue}`) : null;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

try {
  new URL(frontendUrl);
} catch {
  throw new Error("FRONTEND_URL must be an absolute URL");
}

if (googleCalendarRedirectUri) {
  try { new URL(googleCalendarRedirectUri); } catch { throw new Error("GOOGLE_CALENDAR_REDIRECT_URI must be an absolute URL"); }
}

if (ngrokDomain) {
  try { if (new URL(ngrokDomain).protocol !== "https:") throw new Error(); } catch { throw new Error("NGROK_DOMAIN must be an absolute HTTPS URL"); }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  agentDebugRawOutput: process.env.AGENT_DEBUG_RAW_OUTPUT?.trim().toLowerCase() === "true" || process.env.MISSION_DEBUG_RAW_OUTPUT?.trim().toLowerCase() === "true",
  performanceDebug: process.env.PERFORMANCE_DEBUG?.trim().toLowerCase() === "true",
  port,
  frontendUrl,
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean),
  supabaseUrl: process.env.SUPABASE_URL?.trim() || null,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || null,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || null,
  googleCalendarRedirectUri,
  googleOauthStateSecret: process.env.GOOGLE_OAUTH_STATE_SECRET?.trim() || null,
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY?.trim() || null,
  telegramBotToken,
  telegramWebhookSecret,
  ngrokAuthToken,
  ngrokDomain,
};
