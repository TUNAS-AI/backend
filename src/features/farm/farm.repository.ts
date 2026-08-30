import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../infrastructure/prisma";
import type { FarmInput, FarmRecord } from "./farm.types";

const record = (value: unknown) => value as FarmRecord;
function data(input: FarmInput) { return {
  ...(input.name !== undefined ? { name: input.name as string } : {}), ...(input.location !== undefined ? { location: input.location as string | null } : {}),
  ...(input.notes !== undefined ? { notes: input.notes as string | null } : {}), ...(input.timezone !== undefined ? { timezone: input.timezone as string } : {}),
  ...(input.defaultWorkerCount !== undefined ? { defaultWorkerCount: input.defaultWorkerCount as number } : {}),
  ...(input.rainProtectionAvailable !== undefined ? { rainProtectionAvailable: input.rainProtectionAvailable as boolean | null } : {}),
  ...(input.defaultWorkingHours !== undefined ? { defaultWorkingHours: input.defaultWorkingHours === null ? Prisma.JsonNull : input.defaultWorkingHours as Prisma.InputJsonValue } : {}),
  ...(input.dryingProfile !== undefined ? { dryingProfile: input.dryingProfile === null ? Prisma.JsonNull : input.dryingProfile as Prisma.InputJsonValue } : {}),
  ...(input.schedulingDurations !== undefined ? { schedulingDurations: input.schedulingDurations as Prisma.InputJsonValue } : {}),
}; }
export class FarmRepository {
  async findByOwner(ownerId: string) { const farm = await getPrisma().farm.findUnique({ where: { ownerId } }); return farm ? record(farm) : null; }
  async snapshot(ownerId: string) {
    const farm = await getPrisma().farm.findUnique({ where: { ownerId }, include: { fieldBlocks: { orderBy: { createdAt: "asc" } }, cropBatches: { orderBy: { createdAt: "asc" } } } });
    if (!farm) return null;
    const { fieldBlocks, cropBatches, ...farmRecord } = farm;
    return { farm: record(farmRecord), fieldBlocks, cropBatches };
  }
  async create(ownerId: string, input: FarmInput) { return record(await getPrisma().farm.create({ data: { ownerId, ...data(input), name: input.name as string, defaultWorkerCount: input.defaultWorkerCount as number } })); }
  async update(farmId: string, input: FarmInput) { return record(await getPrisma().farm.update({ where: { farmId }, data: data(input) })); }
  async delete(ownerId: string, farmId: string) {
    await getPrisma().$transaction(async (tx) => {
      await tx.telegramLinkToken.deleteMany({ where: { userId: ownerId } });
      await tx.telegramConnection.deleteMany({ where: { userId: ownerId } });
      await tx.mission.deleteMany({ where: { farmId } });
      await tx.farm.delete({ where: { farmId } });
    });
  }
}
