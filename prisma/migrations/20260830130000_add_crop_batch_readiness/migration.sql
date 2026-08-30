ALTER TABLE "crop_batches" ADD COLUMN "readiness_status" TEXT;

ALTER TABLE "crop_batches"
  ADD CONSTRAINT "crop_batches_readiness_status_check"
  CHECK ("readiness_status" IS NULL OR "readiness_status" IN ('READY', 'NOT_READY'));
