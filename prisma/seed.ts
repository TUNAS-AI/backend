import "dotenv/config";
import { getPrisma } from "../src/infrastructure/prisma";

const seedMessage = "[seed] Panen bawang merah untuk pesanan pasar minggu ini.";
const today = new Date();
const date = (daysFromToday: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysFromToday));

async function seed() {
  const prisma = getPrisma();
  const farm = await prisma.farm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!farm) throw new Error("No farm found. Complete onboarding before running the seed.");

  const field = await prisma.fieldBlock.upsert({
    where: { farmId_name: { farmId: farm.farmId, name: "Lahan Demo Utara" } },
    update: { areaHectares: 0.75, latitude: -7.79558, longitude: 110.36949, notes: "Data demo untuk halaman mission.", status: "active" },
    create: { farmId: farm.farmId, name: "Lahan Demo Utara", areaHectares: 0.75, latitude: -7.79558, longitude: 110.36949, notes: "Data demo untuk halaman mission." },
  });
  const batch = await prisma.cropBatch.findFirst({ where: { farmId: farm.farmId, fieldBlockId: field.fieldBlockId, variety: "Bima Brebes" } })
    ?? await prisma.cropBatch.create({ data: { farmId: farm.farmId, fieldBlockId: field.fieldBlockId, crop: "shallot", variety: "Bima Brebes", plantingDate: date(-58), notes: "Siap dipanen dalam minggu ini." } });
  const previousMission = await prisma.mission.findFirst({ where: { farmId: farm.farmId, originalMessage: seedMessage } });
  if (previousMission) await prisma.mission.delete({ where: { missionId: previousMission.missionId } });

  const mission = await prisma.$transaction(async (tx) => {
    const createdMission = await tx.mission.create({
      data: {
        farmId: farm.farmId, fieldBlockId: field.fieldBlockId, originalMessage: seedMessage,
        notes: "Gunakan data ini untuk membangun dan memeriksa halaman mission. Catatan pembeli: utamakan umbi kering dan bersih.",
        messages: { create: [{ role: "farmer", content: "Bawang merah di Lahan Demo Utara siap panen. Saya menargetkan 450 kg minggu ini." }, { role: "assistant", content: "Rencana panen dan pengeringan sudah disiapkan berdasarkan kondisi lapangan." }] },
        constraints: { create: [{ key: "plannedHarvestKg", value: 600, provenance: "FARMER_REPORTED", confidence: "high" }, { key: "plannedDriedKg", value: 450, provenance: "FARMER_REPORTED", confidence: "high" }, { key: "deadline", value: date(5).toISOString(), provenance: "FARMER_REPORTED", confidence: "high" }] },
        cropBatches: { create: { cropBatch: { connect: { farmId_cropBatchId: { farmId: farm.farmId, cropBatchId: batch.cropBatchId } } } } },
      },
    });
    const run = await tx.planningRun.create({ data: { missionId: createdMission.missionId, status: "SUCCEEDED", completedAt: new Date() } });
    const plan = await tx.plan.create({
      data: {
        missionId: createdMission.missionId, planningRunId: run.planningRunId, name: "Panen pagi dan pengeringan terlindung", recommended: true,
        summary: "Panen saat cuaca paling kering, lalu keringkan bertahap agar pesanan 450 kg dapat dipenuhi sebelum tenggat.",
        assumptions: ["Tenaga kerja tersedia setiap pagi", "Area pengeringan terlindung dari hujan"], risks: { cuaca: "Hujan sore dapat memperlambat pengeringan." }, dryingEstimateDays: 3, dryingEstimateReason: "Kondisi pengeringan terlindung dengan sirkulasi udara baik.",
        steps: { create: [
          { sequence: 1, title: "Panen bawang merah", description: "Panen dari Lahan Demo Utara dan pisahkan umbi rusak.", scheduleType: "DAILY_WINDOW", startsOn: date(1), endsOn: date(2), windowStart: "06:00", windowEnd: "10:00", timezone: farm.timezone, stage: "HARVESTING" },
          { sequence: 2, title: "Pengeringan terlindung", description: "Susun umbi di area berventilasi dan lindungi dari hujan sore.", scheduleType: "DATE_RANGE", startsOn: date(2), endsOn: date(4), timezone: farm.timezone, stage: "DRYING" },
          { sequence: 3, title: "Sortir dan siapkan pesanan", description: "Timbang 450 kg grade Super untuk Pasar Giwangan.", scheduleType: "DAILY_WINDOW", startsOn: date(5), endsOn: date(5), windowStart: "07:00", windowEnd: "11:00", timezone: farm.timezone, stage: "DRYING" },
        ] },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    await tx.missionStep.createMany({ data: plan.steps.map((step) => ({ missionId: createdMission.missionId, sourcePlanStepId: step.planStepId, sequence: step.sequence, title: step.title, description: step.description, scheduleType: step.scheduleType, startsOn: step.startsOn, endsOn: step.endsOn, windowStart: step.windowStart, windowEnd: step.windowEnd, timezone: step.timezone, isConditional: step.isConditional, stage: step.stage })) });
    await tx.weatherSnapshot.create({ data: { farmId: farm.farmId, fieldBlockId: field.fieldBlockId, source: "seed", observedAt: new Date(), payload: { summary: "Cerah berawan pada pagi hari, peluang hujan sore rendah.", seeded: true } } });
    return tx.mission.update({ where: { missionId: createdMission.missionId }, data: { approvedPlanId: plan.planId } });
  });

  console.log(`Seeded mission ${mission.missionId} for ${farm.name}.`);
  await prisma.$disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect();
  process.exitCode = 1;
});
