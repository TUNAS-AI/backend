import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:5173").trim().replace(/\/$/, "");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

try {
  new URL(frontendUrl);
} catch {
  throw new Error("FRONTEND_URL must be an absolute URL");
}

export const env = {
  port,
  frontendUrl,
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  supabaseUrl: process.env.SUPABASE_URL?.trim() || null,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || null,
};
