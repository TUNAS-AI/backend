import { getPrisma } from "../../infrastructure/prisma";

export class FarmStructureDeletionRepository {
  async missionIdsForFieldBlock(farmId: string, fieldBlockId: string) {
    const missions = await getPrisma().mission.findMany({
      where: { farmId, OR: [{ fieldBlockId }, { cropBatches: { some: { cropBatch: { fieldBlockId } } } }] },
      select: { missionId: true },
    });
    return missions.map((mission) => mission.missionId);
  }

  async missionIdsForCropBatch(farmId: string, cropBatchId: string) {
    const missions = await getPrisma().mission.findMany({
      where: { farmId, cropBatches: { some: { cropBatchId } } },
      select: { missionId: true },
    });
    return missions.map((mission) => mission.missionId);
  }

  async deleteFieldBlock(farmId: string, fieldBlockId: string, missionIds: string[]) {
    await getPrisma().$transaction(async (tx) => {
      if (missionIds.length) await tx.mission.deleteMany({ where: { farmId, missionId: { in: missionIds } } });
      await tx.fieldBlock.deleteMany({ where: { farmId, fieldBlockId } });
    });
  }

  async deleteCropBatch(farmId: string, cropBatchId: string, missionIds: string[]) {
    await getPrisma().$transaction(async (tx) => {
      if (missionIds.length) await tx.mission.deleteMany({ where: { farmId, missionId: { in: missionIds } } });
      await tx.cropBatch.deleteMany({ where: { farmId, cropBatchId } });
    });
  }
}
