import "dotenv/config";
import { getPrisma } from "../src/infrastructure/prisma";

const today = new Date();
const plantingDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 62));
const workingHours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => [day, [{ start: "06:00", end: "16:00" }]]));

async function seed() {
  const prisma = getPrisma();
  const farm = await prisma.farm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!farm) throw new Error("No farm found. Complete onboarding before running the demo seed.");

  await prisma.$transaction(async (tx) => {
    await tx.mission.deleteMany({ where: { farmId: farm.farmId } });
    await tx.fieldBlock.deleteMany({ where: { farmId: farm.farmId } });
    await tx.farm.update({
      where: { farmId: farm.farmId },
      data: {
        name: "Tani Makmur Brebes",
        location: "Brebes, Central Java",
        timezone: "Asia/Jakarta",
        defaultWorkerCount: 4,
        defaultWorkingHours: workingHours,
        notes: "Workers: Pak Dedi, Pak Ujang, Bu Sari, and Pak Wawan. Drying method: outdoor drying. Rain protection: tarpaulin available.",
      },
    });
    await tx.fieldBlock.create({
      data: {
        farmId: farm.farmId,
        name: "Blok Utara",
        latitude: -6.867120,
        longitude: 109.037109,
        areaHectares: 0.8,
        notes: "Farmer-reported readiness: READY. Estimated harvestable quantity: 650 kg.",
        cropBatches: { create: { farmId: farm.farmId, crop: "shallot", variety: "Bima Brebes", plantingDate, notes: "Farmer-reported readiness: READY. Estimated harvestable quantity: 650 kg." } },
      },
    });
  });

  console.log(`Reset ${farm.farmId} to the zero-mission TUNAS demo state.`);
  await prisma.$disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect();
  process.exitCode = 1;
});
