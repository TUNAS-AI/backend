import type { NextFunction, Request, Response } from "express";
import { sendApiError, ApiError } from "../../shared/api-error";
import { serializeRecord } from "../../shared/record-serializer";
import { FarmService } from "./farm.service";
import { parseFarm } from "./farm.validation";
const service = new FarmService();
const owner = (request: Request) => { if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required"); return request.userId; };
export const farmController = {
  get: async (request: Request, response: Response, next: NextFunction) => { try { response.json(serializeRecord(await service.get(owner(request)))); } catch (error) { sendApiError(error, response, next); } },
  create: async (request: Request, response: Response, next: NextFunction) => { try { response.status(201).json(serializeRecord(await service.create(owner(request), parseFarm(request.body, true)))); } catch (error) { sendApiError(error, response, next); } },
  update: async (request: Request, response: Response, next: NextFunction) => { try { response.json(serializeRecord(await service.update(owner(request), parseFarm(request.body, false)))); } catch (error) { sendApiError(error, response, next); } },
  delete: async (request: Request, response: Response, next: NextFunction) => { try { await service.delete(owner(request), request.body); response.status(204).end(); } catch (error) { sendApiError(error, response, next); } },
};
