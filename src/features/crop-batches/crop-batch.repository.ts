import { getPrisma } from "../../infrastructure/prisma"; import type { CropBatchInput } from "./crop-batch.validation";
const record = (value: unknown) => value as Record<string, unknown>; const data = (i: CropBatchInput) => ({ ...(i.fieldBlockId !== undefined ? { fieldBlockId: i.fieldBlockId as string } : {}), ...(i.variety !== undefined ? { variety: i.variety as string | null } : {}), ...(i.plantingDate !== undefined ? { plantingDate: i.plantingDate as Date | null } : {}), ...(i.notes !== undefined ? { notes: i.notes as string | null } : {}), ...(i.status !== undefined ? { status: i.status as string } : {}), ...(i.readinessStatus !== undefined ? { readinessStatus: i.readinessStatus as string } : {}) });
export class CropBatchRepository {
  async list(farmId: string) { return (await getPrisma().cropBatch.findMany({ where: { farmId }, orderBy: { createdAt: "asc" } })).map(record); }
  async find(farmId: string, cropBatchId: string) { const value = await getPrisma().cropBatch.findFirst({ where: { farmId, cropBatchId } }); return value ? record(value) : null; }
  async findFieldBlock(farmId: string, fieldBlockId: string) { return getPrisma().fieldBlock.findFirst({ where: { farmId, fieldBlockId } }); }
  async create(farmId: string, i: CropBatchInput) { return record(await getPrisma().cropBatch.create({ data: { farmId, ...data(i), fieldBlockId: i.fieldBlockId as string, crop: "shallot" } })); }
  async update(farmId: string, cropBatchId: string, i: CropBatchInput) { await getPrisma().cropBatch.updateMany({ where: { farmId, cropBatchId }, data: data(i) }); return this.find(farmId, cropBatchId); }
  async delete(farmId: string, cropBatchId: string) { await getPrisma().cropBatch.deleteMany({ where: { farmId, cropBatchId } }); }
}
