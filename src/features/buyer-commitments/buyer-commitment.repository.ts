import { getPrisma } from "../../infrastructure/prisma"; import type { BuyerCommitmentInput } from "./buyer-commitment.validation";
const record = (value: unknown) => value as Record<string, unknown>; const data = (i: BuyerCommitmentInput) => ({ ...(i.cropBatchId !== undefined ? { cropBatchId: i.cropBatchId as string } : {}), ...(i.buyerName !== undefined ? { buyerName: i.buyerName as string } : {}), ...(i.quantityKg !== undefined ? { quantityKg: i.quantityKg as number } : {}), ...(i.targetGrade !== undefined ? { targetGrade: i.targetGrade as string | null } : {}), ...(i.deadline !== undefined ? { deadline: i.deadline as Date } : {}), ...(i.notes !== undefined ? { notes: i.notes as string | null } : {}), ...(i.status !== undefined ? { status: i.status as string } : {}) });
export class BuyerCommitmentRepository {
  async list(farmId: string) { return (await getPrisma().buyerCommitment.findMany({ where: { farmId }, orderBy: { deadline: "asc" } })).map(record); }
  async find(farmId: string, buyerCommitmentId: string) { const value = await getPrisma().buyerCommitment.findFirst({ where: { farmId, buyerCommitmentId } }); return value ? record(value) : null; }
  async findCropBatch(farmId: string, cropBatchId: string) { return getPrisma().cropBatch.findFirst({ where: { farmId, cropBatchId } }); }
  async create(farmId: string, i: BuyerCommitmentInput) { return record(await getPrisma().buyerCommitment.create({ data: { farmId, ...data(i), cropBatchId: i.cropBatchId as string, buyerName: i.buyerName as string, quantityKg: i.quantityKg as number, deadline: i.deadline as Date } })); }
  async update(farmId: string, buyerCommitmentId: string, i: BuyerCommitmentInput) { await getPrisma().buyerCommitment.updateMany({ where: { farmId, buyerCommitmentId }, data: data(i) }); return this.find(farmId, buyerCommitmentId); }
  async delete(farmId: string, buyerCommitmentId: string) { await getPrisma().buyerCommitment.deleteMany({ where: { farmId, buyerCommitmentId } }); }
}
