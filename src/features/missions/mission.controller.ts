import type { NextFunction, Request, Response } from "express";
import { ApiError, sendApiError } from "../../shared/api-error";
import { serializeRecord } from "../../shared/record-serializer";
import { MissionService } from "./mission.service";
import { parseCalendarRange, parseCloseout, parseConfirmation, parseMissionId, parsePreviewCandidate, parsePreviewInterpret, parseReplanConfirmation, parseStage, parseStepStatus } from "./mission.validation";

const service = new MissionService();
const owner = (request: Request) => { if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required"); return request.userId; };
const respond = (work: (request: Request) => Promise<unknown>, status = 200) => async (request: Request, response: Response, next: NextFunction) => { try { response.status(status).json(serializeRecord(await work(request) as Record<string, unknown>)); } catch (error) { sendApiError(error, response, next); } };

export const missionController = {
  list: respond((request) => service.list(owner(request))),
  calendar: respond((request) => service.calendar(owner(request), parseCalendarRange(request.query))),
  get: respond((request) => service.get(owner(request), parseMissionId(request.params.id, "missionId"))),
  delete: respond((request) => service.delete(owner(request), parseMissionId(request.params.id, "missionId"))),
  interpretPreview: respond((request) => service.interpret(owner(request), parsePreviewInterpret(request.body))),
  planPreview: respond((request) => service.planPreview(owner(request), parsePreviewCandidate(request.body))),
  confirm: respond((request) => { const input = parseConfirmation(request.body); return service.confirm(owner(request), input.previewToken, input.planId); }, 201),
  replanDraft: respond((request) => service.replanDraft(owner(request), parseMissionId(request.params.id, "missionId"))),
  interpretReplan: respond((request) => service.interpretReplan(owner(request), parseMissionId(request.params.id, "missionId"), parsePreviewInterpret(request.body))),
  planReplan: respond((request) => service.replanPreview(owner(request), parseMissionId(request.params.id, "missionId"), parsePreviewCandidate(request.body))),
  confirmReplan: respond((request) => { const input = parseReplanConfirmation(request.body); return service.confirmReplan(owner(request), parseMissionId(request.params.id, "missionId"), input); }),
  advance: respond((request) => service.advance(owner(request), parseMissionId(request.params.id, "missionId"), parseStage(request.body))),
  updateStepStatus: respond((request) => service.updateStepStatus(owner(request), parseMissionId(request.params.id, "missionId"), parseMissionId(request.params.stepId, "stepId"), parseStepStatus(request.body))),
  closeout: respond((request) => service.closeout(owner(request), parseMissionId(request.params.id, "missionId"), parseCloseout(request.body))),
  confirmCloseout: respond((request) => service.confirmCloseout(owner(request), parseMissionId(request.params.id, "missionId"))),
};
