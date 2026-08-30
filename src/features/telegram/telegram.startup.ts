import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../../config/env";
import { TelegramService } from "./telegram.service";

let tunnel: ChildProcess | null = null;

export async function startTelegramIntegration() {
  const configured = [env.telegramBotToken, env.telegramWebhookSecret, env.ngrokDomain, env.ngrokAuthToken];
  if (configured.every((value) => !value)) return;
  if (configured.some((value) => !value)) throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, NGROK_DOMAIN, and NGROK_AUTHTOKEN must all be set");
  tunnel = spawn("ngrok", ["http", String(env.port), "--url", env.ngrokDomain!, "--authtoken", env.ngrokAuthToken!, "--log", "stdout", "--log-level", "warn"], { stdio: ["ignore", "inherit", "inherit"] });
  tunnel.once("error", (error) => console.error("Telegram tunnel failed", error.message));
  tunnel.once("exit", (code) => { if (code) console.error(`Telegram tunnel exited with code ${code}`); tunnel = null; });
  await new TelegramService().setWebhook();
}

export function stopTelegramIntegration() {
  tunnel?.kill("SIGTERM");
  tunnel = null;
}
