import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { FarmStructureDeletionService } from "../farm/farm-structure-deletion.service";
import { FieldBlockRepository } from "./field-block.repository";
import type { FieldBlockInput } from "./field-block.validation";
export class FieldBlockService {
  constructor(private readonly repository = new FieldBlockRepository(), private readonly deletion = new FarmStructureDeletionService()) {}
  async list(ownerId: string) { return this.repository.list(await callerFarmId(ownerId)); }
  async get(ownerId: string, id: string) { const item = await this.repository.find(await callerFarmId(ownerId), id); if (!item) throw new ApiError(404, "Field block not found"); return item; }
  async create(ownerId: string, input: FieldBlockInput) { return this.repository.create(await callerFarmId(ownerId), input); }
  async update(ownerId: string, id: string, input: FieldBlockInput) { await this.get(ownerId, id); const item = await this.repository.update(await callerFarmId(ownerId), id, input); if (!item) throw new ApiError(404, "Field block not found"); return item; }
  async delete(ownerId: string, id: string) { const farmId = await callerFarmId(ownerId); if (!await this.repository.find(farmId, id)) throw new ApiError(404, "Field block not found"); await this.deletion.deleteFieldBlock(farmId, id); }
}
