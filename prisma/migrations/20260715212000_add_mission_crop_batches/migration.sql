ALTER TABLE public.missions
  ADD CONSTRAINT missions_farm_id_mission_id_key UNIQUE (farm_id, mission_id);

ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_farm_id_crop_batch_id_fkey,
  DROP COLUMN crop_batch_id;

CREATE TABLE public.mission_crop_batches (
  mission_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  crop_batch_id uuid NOT NULL,
  PRIMARY KEY (mission_id, crop_batch_id),
  FOREIGN KEY (farm_id, mission_id) REFERENCES public.missions(farm_id, mission_id) ON DELETE CASCADE,
  FOREIGN KEY (farm_id, crop_batch_id) REFERENCES public.crop_batches(farm_id, crop_batch_id)
);

CREATE INDEX mission_crop_batches_farm_id_crop_batch_id_idx
  ON public.mission_crop_batches(farm_id, crop_batch_id);
