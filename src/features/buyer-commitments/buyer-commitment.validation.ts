import { ApiError } from "../../shared/api-error"; import { has, input, nullableText, number, text, timestamp, uuid, type Input } from "../../shared/input-validation";
export type BuyerCommitmentInput = Input;
export function parseBuyerCommitment(value: unknown, create: boolean): BuyerCommitmentInput {
  const source = input(value); const result: BuyerCommitmentInput = {};
  if (create) { result.cropBatchId = uuid(source.cropBatchId, "cropBatchId"); result.buyerName = text(source.buyerName, "buyerName"); result.quantityKg = number(source.quantityKg, "quantityKg", Number.MIN_VALUE); result.deadline = timestamp(source.deadline, "deadline"); }
  else { if (has(source, "cropBatchId")) result.cropBatchId = uuid(source.cropBatchId, "cropBatchId"); if (has(source, "buyerName")) result.buyerName = text(source.buyerName, "buyerName"); if (has(source, "quantityKg")) result.quantityKg = number(source.quantityKg, "quantityKg", Number.MIN_VALUE); if (has(source, "deadline")) result.deadline = timestamp(source.deadline, "deadline"); }
  if (has(source, "targetGrade")) result.targetGrade = nullableText(source.targetGrade, "targetGrade"); if (has(source, "notes")) result.notes = nullableText(source.notes, "notes"); if (has(source, "status")) result.status = text(source.status, "status");
  if (!create && Object.keys(result).length === 0) throw new ApiError(400, "Request body must include at least one field"); return result;
}
