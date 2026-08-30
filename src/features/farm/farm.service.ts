import { ApiError } from "../../shared/api-error";
import { GoogleCalendarService } from "../google-calendar/google-calendar.service";
import type { FarmInput, FarmRecord } from "./farm.types";
import { FarmRepository } from "./farm.repository";
type FarmStore = Pick<FarmRepository, "findByOwner" | "snapshot" | "create" | "update" | "delete">;
type FarmCalendarCleanup = Pick<GoogleCalendarService, "removeFarmEvents">;
export class FarmService {
  constructor(private readonly repository: FarmStore = new FarmRepository(), private readonly calendar: FarmCalendarCleanup = new GoogleCalendarService()) {}
  async get(ownerId: string): Promise<FarmRecord> { const farm = await this.repository.findByOwner(ownerId); if (!farm) throw new ApiError(404, "Farm profile not found"); return farm; }
  async hasFarm(ownerId: string) { return Boolean(await this.repository.findByOwner(ownerId)); }
  async snapshot(ownerId: string) { const snapshot = await this.repository.snapshot(ownerId); if (!snapshot) throw new ApiError(404, "Farm profile not found"); return snapshot; }
  async create(ownerId: string, input: FarmInput) { if (await this.repository.findByOwner(ownerId)) throw new ApiError(409, "A farm profile already exists for this user"); return this.repository.create(ownerId, input); }
  async update(ownerId: string, input: FarmInput) { return this.repository.update((await this.get(ownerId)).farmId as string, input); }
  async delete(ownerId: string, confirmation: unknown) {
    if (typeof confirmation !== "object" || confirmation === null || (confirmation as { confirmation?: unknown }).confirmation !== "DELETE_FARM") throw new ApiError(400, "confirmation must equal DELETE_FARM");
    const farmId = (await this.get(ownerId)).farmId as string;
    try { await this.calendar.removeFarmEvents(farmId); } catch (error) { console.warn("Google Calendar cleanup failed during farm deletion", { farmId, kind: error instanceof Error ? error.name : "unknown_error" }); }
    await this.repository.delete(farmId);
  }
}
