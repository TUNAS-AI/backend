import { ApiError } from "../../shared/api-error";
import type { FarmInput, FarmRecord } from "./farm.types";
import { FarmRepository } from "./farm.repository";
export class FarmService {
  constructor(private readonly repository = new FarmRepository()) {}
  async get(ownerId: string): Promise<FarmRecord> { const farm = await this.repository.findByOwner(ownerId); if (!farm) throw new ApiError(404, "Farm profile not found"); return farm; }
  async hasFarm(ownerId: string) { return Boolean(await this.repository.findByOwner(ownerId)); }
  async snapshot(ownerId: string) { const snapshot = await this.repository.snapshot(ownerId); if (!snapshot) throw new ApiError(404, "Farm profile not found"); return snapshot; }
  async create(ownerId: string, input: FarmInput) { if (await this.repository.findByOwner(ownerId)) throw new ApiError(409, "A farm profile already exists for this user"); return this.repository.create(ownerId, input); }
  async update(ownerId: string, input: FarmInput) { return this.repository.update((await this.get(ownerId)).farmId as string, input); }
  async delete(ownerId: string, confirmation: unknown) { if (typeof confirmation !== "object" || confirmation === null || (confirmation as { confirmation?: unknown }).confirmation !== "DELETE_FARM") throw new ApiError(400, "confirmation must equal DELETE_FARM"); await this.repository.delete((await this.get(ownerId)).farmId as string); }
}
