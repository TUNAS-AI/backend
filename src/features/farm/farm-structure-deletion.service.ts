import { GoogleCalendarService } from "../google-calendar/google-calendar.service";
import { FarmStructureDeletionRepository } from "./farm-structure-deletion.repository";

type FarmStructureDeletionStore = Pick<FarmStructureDeletionRepository, "missionIdsForFieldBlock" | "missionIdsForCropBatch" | "deleteFieldBlock" | "deleteCropBatch">;
type MissionCalendarCleanup = Pick<GoogleCalendarService, "removeMissionEvents">;

export class FarmStructureDeletionService {
  constructor(private readonly repository: FarmStructureDeletionStore = new FarmStructureDeletionRepository(), private readonly calendar: MissionCalendarCleanup = new GoogleCalendarService()) {}

  async deleteFieldBlock(farmId: string, fieldBlockId: string) {
    const missionIds = await this.repository.missionIdsForFieldBlock(farmId, fieldBlockId);
    await Promise.all(missionIds.map((missionId) => this.calendar.removeMissionEvents(farmId, missionId)));
    await this.repository.deleteFieldBlock(farmId, fieldBlockId, missionIds);
  }

  async deleteCropBatch(farmId: string, cropBatchId: string) {
    const missionIds = await this.repository.missionIdsForCropBatch(farmId, cropBatchId);
    await Promise.all(missionIds.map((missionId) => this.calendar.removeMissionEvents(farmId, missionId)));
    await this.repository.deleteCropBatch(farmId, cropBatchId, missionIds);
  }
}
