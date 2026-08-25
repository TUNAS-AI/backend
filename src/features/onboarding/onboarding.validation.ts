import { ApiError } from "../../shared/api-error";
import { date, has, input, nullableText } from "../../shared/input-validation";
import { parseFieldBlock } from "../field-blocks/field-block.validation";
import { parseFarm } from "../farm/farm.validation";
import type { OnboardingInput } from "./onboarding.types";

function parseCropBatch(value: unknown, fieldIndex: number, batchIndex: number) {
  const source = input(value);
  const result: OnboardingInput["fields"][number]["cropBatches"][number] = {};
  if (has(source, "variety")) result.variety = nullableText(source.variety, `fields[${fieldIndex}].cropBatches[${batchIndex}].variety`);
  if (has(source, "plantingDate")) result.plantingDate = source.plantingDate === null ? null : date(source.plantingDate, `fields[${fieldIndex}].cropBatches[${batchIndex}].plantingDate`);
  if (has(source, "notes")) result.notes = nullableText(source.notes, `fields[${fieldIndex}].cropBatches[${batchIndex}].notes`);
  return result;
}

export function parseOnboarding(value: unknown): OnboardingInput {
  const source = input(value);
  const farm = parseFarm(source.farm, true);
  const workingHours = farm.defaultWorkingHours;
  if (!workingHours || typeof workingHours !== "object" || !Object.values(workingHours).some((ranges) => Array.isArray(ranges) && ranges.length)) {
    throw new ApiError(400, "farm.defaultWorkingHours must include at least one work window");
  }
  if (!Array.isArray(source.fields) || !source.fields.length) throw new ApiError(400, "fields must include at least one field");

  const fields = source.fields.map((value, fieldIndex) => {
    const fieldSource = input(value);
    if (!Array.isArray(fieldSource.cropBatches) || !fieldSource.cropBatches.length) {
      throw new ApiError(400, `fields[${fieldIndex}].cropBatches must include at least one crop batch`);
    }
    return {
      ...parseFieldBlock(fieldSource, true),
      cropBatches: fieldSource.cropBatches.map((batch, batchIndex) => parseCropBatch(batch, fieldIndex, batchIndex)),
    };
  });

  return { farm, fields };
}
