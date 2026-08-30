ALTER TABLE "public"."farms"
ADD COLUMN "scheduling_durations" JSONB NOT NULL
DEFAULT '{"readinessCheckMinutes":15,"harvestMinutes":360,"transferToDryingMinutes":30,"beginDryingMinutes":15,"dryingInspectionMinutes":30}'::jsonb;
