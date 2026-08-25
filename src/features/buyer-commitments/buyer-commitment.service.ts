import { ApiError } from "../../shared/api-error"; import { callerFarmId } from "../farm/caller-farm.service"; import { BuyerCommitmentRepository } from "./buyer-commitment.repository"; import type { BuyerCommitmentInput } from "./buyer-commitment.validation";
export class BuyerCommitmentService {
  constructor(private readonly repository = new BuyerCommitmentRepository()) {}
  async list(ownerId: string) { return this.repository.list(await callerFarmId(ownerId)); }
  async get(ownerId: string, id: string) { const item = await this.repository.find(await callerFarmId(ownerId), id); if (!item) throw new ApiError(404, "Buyer commitment not found"); return item; }
  async create(ownerId: string, input: BuyerCommitmentInput) { const farmId = await callerFarmId(ownerId); if (!await this.repository.findCropBatch(farmId, input.cropBatchId as string)) throw new ApiError(404, "Crop batch not found"); return this.repository.create(farmId, input); }
  async update(ownerId: string, id: string, input: BuyerCommitmentInput) { const farmId = await callerFarmId(ownerId); await this.get(ownerId, id); if (typeof input.cropBatchId === "string" && !await this.repository.findCropBatch(farmId, input.cropBatchId)) throw new ApiError(404, "Crop batch not found"); const item = await this.repository.update(farmId, id, input); if (!item) throw new ApiError(404, "Buyer commitment not found"); return item; }
  async delete(ownerId: string, id: string) { const farmId = await callerFarmId(ownerId); await this.get(ownerId, id); await this.repository.delete(farmId, id); }
}
