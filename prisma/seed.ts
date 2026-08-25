import "dotenv/config";
import { getPrisma } from "../src/infrastructure/prisma";

async function seed() {
  const prisma = getPrisma();
  const farm = await prisma.farm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!farm) {
    throw new Error("No farm found. Complete onboarding before running the seed.");
  }

  const field = await prisma.fieldBlock.upsert({
    where: { farmId_name: { farmId: farm.farmId, name: "Lahan Demo Utara" } },
    update: {
      areaHectares: 0.75,
      latitude: -7.79558,
      longitude: 110.36949,
      notes: "Sample shallot field for local development.",
      status: "active",
    },
    create: {
      farmId: farm.farmId,
      name: "Lahan Demo Utara",
      areaHectares: 0.75,
      latitude: -7.79558,
      longitude: 110.36949,
      notes: "Sample shallot field for local development.",
    },
  });

  const batch = await prisma.cropBatch.findFirst({
    where: { farmId: farm.farmId, fieldBlockId: field.fieldBlockId, variety: "Bima Brebes" },
  }) ?? await prisma.cropBatch.create({
    data: {
      farmId: farm.farmId,
      fieldBlockId: field.fieldBlockId,
      crop: "shallot",
      variety: "Bima Brebes",
      plantingDate: new Date("2026-05-15T00:00:00.000Z"),
      notes: "Sample crop batch.",
    },
  });

  const existingCommitment = await prisma.buyerCommitment.findFirst({
    where: { farmId: farm.farmId, cropBatchId: batch.cropBatchId, buyerName: "Pasar Giwangan" },
  });
  if (!existingCommitment) {
    await prisma.buyerCommitment.create({
      data: {
        farmId: farm.farmId,
        cropBatchId: batch.cropBatchId,
        buyerName: "Pasar Giwangan",
        quantityKg: 450,
        targetGrade: "Super",
        deadline: new Date("2026-07-24T09:00:00.000Z"),
        notes: "Sample buyer commitment.",
      },
    });
  }

  console.log(`Seeded farm records for ${farm.name}.`);
  await prisma.$disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect();
  process.exitCode = 1;
});
