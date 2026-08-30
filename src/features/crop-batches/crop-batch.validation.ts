import { ApiError } from "../../shared/api-error";
import { date, has, input, nullableText, text, uuid, type Input } from "../../shared/input-validation";
export type CropBatchInput = Input;
export function parseCropBatch(value: unknown, create: boolean): CropBatchInput {
  const source = input(value); const result: CropBatchInput = {};
  if (create) { result.fieldBlockId = uuid(source.fieldBlockId, "fieldBlockId"); result.crop = "shallot"; } else if (has(source, "fieldBlockId")) result.fieldBlockId = uuid(source.fieldBlockId, "fieldBlockId");
  if (has(source, "variety")) result.variety = nullableText(source.variety, "variety"); if (has(source, "plantingDate")) result.plantingDate = source.plantingDate === null ? null : date(source.plantingDate, "plantingDate");
  if (has(source, "notes")) result.notes = nullableText(source.notes, "notes"); if (has(source, "status")) result.status = text(source.status, "status");
  if (has(source, "readinessStatus")) {
    const readiness = text(source.readinessStatus, "readinessStatus");
    if (!['READY', 'NOT_READY'].includes(readiness)) throw new ApiError(400, "readinessStatus must be READY or NOT_READY");
    result.readinessStatus = readiness;
  } else if (create) throw new ApiError(400, "readinessStatus is required");
  if (!create && Object.keys(result).length === 0) throw new ApiError(400, "Request body must include at least one field"); return result;
}
