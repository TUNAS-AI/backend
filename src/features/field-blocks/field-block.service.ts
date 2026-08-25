import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { FieldBlockRepository } from "./field-block.repository";
import type { FieldBlockInput } from "./field-block.validation";
export class FieldBlockService {
  constructor(private readonly repository = new FieldBlockRepository()) {}
  async list(ownerId: string) { return this.repository.list(await callerFarmId(ownerId)); }
  async get(ownerId: string, id: string) { const item = await this.repository.find(await callerFarmId(ownerId), id); if (!item) throw new ApiError(404, "Field block not found"); return item; }
  async create(ownerId: string, input: FieldBlockInput) { return this.repository.create(await callerFarmId(ownerId), input); }
  async update(ownerId: string, id: string, input: FieldBlockInput) { await this.get(ownerId, id); const item = await this.repository.update(await callerFarmId(ownerId), id, input); if (!item) throw new ApiError(404, "Field block not found"); return item; }
  async delete(ownerId: string, id: string) { await this.get(ownerId, id); await this.repository.delete(await callerFarmId(ownerId), id); }
}
