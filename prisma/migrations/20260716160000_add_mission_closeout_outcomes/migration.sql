ALTER TABLE public.mission_closeouts
  ADD COLUMN harvested_area_hectares numeric(12, 4),
  ADD COLUMN buyer_target_met boolean,
  ADD COLUMN drying_completed boolean,
  ADD COLUMN rejected_kg numeric(14, 3),
  ALTER COLUMN summary DROP NOT NULL;

UPDATE public.mission_closeouts
  SET buyer_target_met = actual_harvest_kg >= planned_harvest_kg,
      drying_completed = actual_dried_kg > 0
  WHERE buyer_target_met IS NULL OR drying_completed IS NULL;

ALTER TABLE public.mission_closeouts
  ALTER COLUMN buyer_target_met SET NOT NULL,
  ALTER COLUMN drying_completed SET NOT NULL;
