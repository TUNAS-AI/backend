import { env } from "../../config/env";
import { TelegramService } from "./telegram.service";

export async function startTelegramIntegration() {
  const configured = [env.telegramBotToken, env.telegramWebhookSecret, env.ngrokDomain, env.ngrokAuthToken];
  if (configured.every((value) => !value)) return;
  if (configured.some((value) => !value)) throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, NGROK_DOMAIN, and NGROK_AUTHTOKEN must all be set");
  await new TelegramService().setWebhook();
}
