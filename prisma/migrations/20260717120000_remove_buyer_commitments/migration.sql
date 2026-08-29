ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_farm_id_buyer_commitment_id_fkey,
  DROP COLUMN IF EXISTS buyer_commitment_id;

ALTER TABLE public.mission_closeouts
  DROP COLUMN IF EXISTS buyer_target_met;

DROP TABLE IF EXISTS public.buyer_commitments;
