import type { NextFunction, Request, Response } from "express";
import { ApiError, sendApiError } from "../../shared/api-error";
import { serializeRecord } from "../../shared/record-serializer";
import { FieldBlockService } from "./field-block.service";
import { parseFieldBlock } from "./field-block.validation";
const service = new FieldBlockService(); const owner = (r: Request) => { if (!r.userId) throw new ApiError(401, "A Supabase bearer token is required"); return r.userId; }; const id = (r: Request) => typeof r.params.id === "string" ? r.params.id : "";
export const fieldBlockController = {
  list: async (r: Request, s: Response, n: NextFunction) => { try { s.json((await service.list(owner(r))).map(serializeRecord)); } catch (e) { sendApiError(e, s, n); } },
  get: async (r: Request, s: Response, n: NextFunction) => { try { s.json(serializeRecord(await service.get(owner(r), id(r)))); } catch (e) { sendApiError(e, s, n); } },
  create: async (r: Request, s: Response, n: NextFunction) => { try { s.status(201).json(serializeRecord(await service.create(owner(r), parseFieldBlock(r.body, true)))); } catch (e) { sendApiError(e, s, n); } },
  update: async (r: Request, s: Response, n: NextFunction) => { try { s.json(serializeRecord(await service.update(owner(r), id(r), parseFieldBlock(r.body, false)))); } catch (e) { sendApiError(e, s, n); } },
  delete: async (r: Request, s: Response, n: NextFunction) => { try { await service.delete(owner(r), id(r)); s.status(204).end(); } catch (e) { sendApiError(e, s, n); } },
};
