import { getPrisma } from "../../infrastructure/prisma";
import type { FieldBlockInput } from "./field-block.validation";
const record = (value: unknown) => value as Record<string, unknown>;
function data(input: FieldBlockInput) { return {
  ...(input.name !== undefined ? { name: input.name as string } : {}), ...(input.areaHectares !== undefined ? { areaHectares: input.areaHectares as number | null } : {}),
  ...(input.latitude !== undefined ? { latitude: input.latitude as number } : {}), ...(input.longitude !== undefined ? { longitude: input.longitude as number } : {}),
  ...(input.notes !== undefined ? { notes: input.notes as string | null } : {}), ...(input.status !== undefined ? { status: input.status as string } : {}),
}; }
export class FieldBlockRepository {
  async list(farmId: string) { return (await getPrisma().fieldBlock.findMany({ where: { farmId }, orderBy: { createdAt: "asc" } })).map(record); }
  async find(farmId: string, fieldBlockId: string) { const value = await getPrisma().fieldBlock.findFirst({ where: { farmId, fieldBlockId } }); return value ? record(value) : null; }
  async create(farmId: string, input: FieldBlockInput) { return record(await getPrisma().fieldBlock.create({ data: { farmId, ...data(input), name: input.name as string, latitude: input.latitude as number, longitude: input.longitude as number } })); }
  async update(farmId: string, fieldBlockId: string, input: FieldBlockInput) { await getPrisma().fieldBlock.updateMany({ where: { farmId, fieldBlockId }, data: data(input) }); return this.find(farmId, fieldBlockId); }
  async delete(farmId: string, fieldBlockId: string) { await getPrisma().fieldBlock.deleteMany({ where: { farmId, fieldBlockId } }); }
}
