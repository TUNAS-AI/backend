import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { ApiError, sendApiError } from "../../shared/api-error";
import { GoogleCalendarService } from "./google-calendar.service";

const service = new GoogleCalendarService();
const owner = (request: Request) => { if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required"); return request.userId; };
const respond = (work: (request: Request) => Promise<unknown>) => async (request: Request, response: Response, next: NextFunction) => { try { response.json(await work(request)); } catch (error) { sendApiError(error, response, next); } };

export const googleCalendarController = {
  status: respond((request) => service.status(owner(request))),
  connect: respond((request) => service.connect(owner(request))),
  sync: respond((request) => service.sync(owner(request))),
  disconnect: respond((request) => service.disconnect(owner(request))),
  callback: async (request: Request, response: Response) => {
    const redirect = new URL("/calendar", env.frontendUrl);
    try { await service.complete(request.query); redirect.searchParams.set("calendar", "connected"); } catch { redirect.searchParams.set("calendar", "error"); }
    response.redirect(302, redirect.toString());
  },
};
