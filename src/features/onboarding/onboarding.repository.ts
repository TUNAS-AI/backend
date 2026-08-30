import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../infrastructure/prisma";
import { ApiError } from "../../shared/api-error";
import type { OnboardingInput } from "./onboarding.types";

export type OnboardingDatabase = Pick<ReturnType<typeof getPrisma>, "$transaction">;

export class OnboardingRepository {
  constructor(private readonly prisma?: OnboardingDatabase) {}

  async create(ownerId: string, input: OnboardingInput) {
    return (this.prisma ?? getPrisma()).$transaction(async (transaction) => {
      if (await transaction.farm.findUnique({ where: { ownerId }, select: { farmId: true } })) {
        throw new ApiError(409, "A farm profile already exists for this user");
      }

      const farm = await transaction.farm.create({
        data: {
          ownerId,
          name: input.farm.name as string,
          location: (input.farm.location ?? null) as string | null,
          notes: (input.farm.notes ?? null) as string | null,
          timezone: (input.farm.timezone ?? "Asia/Jakarta") as string,
          defaultWorkerCount: input.farm.defaultWorkerCount as number,
          rainProtectionAvailable: (input.farm.rainProtectionAvailable ?? null) as boolean | null,
          defaultWorkingHours: input.farm.defaultWorkingHours as Prisma.InputJsonValue,
        },
      });

      for (const field of input.fields) {
        const fieldBlock = await transaction.fieldBlock.create({
          data: {
            farmId: farm.farmId,
            name: field.name as string,
            latitude: field.latitude as number,
            longitude: field.longitude as number,
            areaHectares: (field.areaHectares ?? null) as number | null,
            notes: (field.notes ?? null) as string | null,
          },
        });
        await transaction.cropBatch.createMany({
          data: field.cropBatches.map((batch) => ({
            farmId: farm.farmId,
            fieldBlockId: fieldBlock.fieldBlockId,
            crop: "shallot",
            variety: batch.variety ?? null,
            plantingDate: batch.plantingDate ?? null,
            notes: batch.notes ?? null,
            readinessStatus: batch.readinessStatus as string,
          })),
        });
      }

      return farm;
    });
  }
}
