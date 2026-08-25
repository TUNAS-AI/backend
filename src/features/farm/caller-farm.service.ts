import { ApiError } from "../../shared/api-error";
import { FarmRepository } from "./farm.repository";
const repository = new FarmRepository();
export async function callerFarmId(ownerId: string): Promise<string> { const farm = await repository.findByOwner(ownerId); if (!farm) throw new ApiError(404, "Farm profile not found"); return farm.farmId as string; }
