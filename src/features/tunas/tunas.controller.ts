import type { NextFunction, Request, Response } from "express";
import { ApiError, sendApiError } from "../../shared/api-error";
import { serializeRecord } from "../../shared/record-serializer";
import { TunasService } from "./tunas.service";
import { parseAction, parseInteraction, parseMessageId, parseMissionBody, parsePendingActionId, parseScenario } from "./tunas.validation";
import { uuid } from "../../shared/input-validation";

const service = new TunasService();
const owner = (request: Request) => { if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required"); return request.userId; };
const respond = (work: (request: Request) => Promise<unknown>) => async (request: Request, response: Response, next: NextFunction) => { try { response.json(serializeRecord(await work(request) as Record<string, unknown>)); } catch (error) { sendApiError(error, response, next); } };
export const tunasController = {
  messages: respond((request) => service.messages(owner(request))), interactions: respond((request) => service.interactions(owner(request))), dailyCheck: respond((request) => service.dailyCheck(owner(request))), markRead: respond((request) => service.markRead(owner(request))),
  act: respond((request) => service.act(owner(request), parseMessageId(request.params.messageId), parseAction(request.body))), test: respond((request) => service.test(owner(request), parseMissionBody(request.body), parseScenario(request.params.scenario))),
  interact: respond((request) => service.interact(owner(request), parseInteraction(request.body, request.get("Idempotency-Key")))),
  approve: respond((request) => service.approve(owner(request), parsePendingActionId(request.params.pendingActionId))),
  reject: respond((request) => service.reject(owner(request), parsePendingActionId(request.params.pendingActionId))),
  cancel: respond((request) => service.cancel(owner(request), parsePendingActionId(request.params.pendingActionId), "web")),
  timeline: respond((request) => service.timeline(owner(request), uuid(request.params.id, "id"))),
  reports: respond((request) => service.reports(owner(request), uuid(request.params.id, "id"))),
};
