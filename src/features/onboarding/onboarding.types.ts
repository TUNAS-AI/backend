import type { FieldBlockInput } from "../field-blocks/field-block.validation";
import type { FarmInput } from "../farm/farm.types";

export type OnboardingInput = {
  farm: FarmInput;
  fields: Array<FieldBlockInput & {
    cropBatches: Array<{
      variety?: string | null;
      plantingDate?: Date | null;
      notes?: string | null;
      readinessStatus?: "READY" | "NOT_READY";
    }>;
  }>;
};
