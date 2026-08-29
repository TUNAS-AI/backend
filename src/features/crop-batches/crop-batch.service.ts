import { ApiError } from "../../shared/api-error"; import { callerFarmId } from "../farm/caller-farm.service"; import { FarmStructureDeletionService } from "../farm/farm-structure-deletion.service"; import { CropBatchRepository } from "./crop-batch.repository"; import type { CropBatchInput } from "./crop-batch.validation";
export class CropBatchService {
  constructor(private readonly repository = new CropBatchRepository(), private readonly deletion = new FarmStructureDeletionService()) {}
  async list(ownerId: string) { return this.repository.list(await callerFarmId(ownerId)); }
  async get(ownerId: string, id: string) { const item = await this.repository.find(await callerFarmId(ownerId), id); if (!item) throw new ApiError(404, "Crop batch not found"); return item; }
  async create(ownerId: string, input: CropBatchInput) { const farmId = await callerFarmId(ownerId); if (!await this.repository.findFieldBlock(farmId, input.fieldBlockId as string)) throw new ApiError(404, "Field block not found"); return this.repository.create(farmId, input); }
  async update(ownerId: string, id: string, input: CropBatchInput) { const farmId = await callerFarmId(ownerId); await this.get(ownerId, id); if (typeof input.fieldBlockId === "string" && !await this.repository.findFieldBlock(farmId, input.fieldBlockId)) throw new ApiError(404, "Field block not found"); const item = await this.repository.update(farmId, id, input); if (!item) throw new ApiError(404, "Crop batch not found"); return item; }
  async delete(ownerId: string, id: string) { const farmId = await callerFarmId(ownerId); if (!await this.repository.find(farmId, id)) throw new ApiError(404, "Crop batch not found"); await this.deletion.deleteCropBatch(farmId, id); }
}
