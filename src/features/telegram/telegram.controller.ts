import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { ApiError, sendApiError } from "../../shared/api-error";
import { TelegramService } from "./telegram.service";

const service = new TelegramService();
const owner = (request: Request) => { if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required"); return request.userId; };
const respond = (work: (request: Request) => Promise<unknown>) => async (request: Request, response: Response, next: NextFunction) => { try { response.json(await work(request)); } catch (error) { sendApiError(error, response, next); } };

export function validTelegramWebhookSecret(value: unknown) {
  if (typeof value !== "string" || !env.telegramWebhookSecret) return false;
  const actual = Buffer.from(value); const expected = Buffer.from(env.telegramWebhookSecret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const telegramController = {
  status: respond((request) => service.status(owner(request))),
  connect: respond((request) => service.connect(owner(request))),
  webhook: async (request: Request, response: Response, next: NextFunction) => {
    if (!validTelegramWebhookSecret(request.get("X-Telegram-Bot-Api-Secret-Token"))) return response.status(401).json({ error: "Telegram webhook secret is invalid" });
    try { response.json(await service.webhook(request.body)); } catch (error) { sendApiError(error, response, next); }
  },
};
