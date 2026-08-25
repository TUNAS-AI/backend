ALTER TABLE public.farms
  ADD COLUMN default_worker_count integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT farms_default_worker_count_check CHECK (default_worker_count > 0);

ALTER TABLE public.crop_batches
  ADD COLUMN estimated_harvest_readiness text NOT NULL DEFAULT 'UNSURE',
  ADD CONSTRAINT crop_batches_estimated_harvest_readiness_check
    CHECK (estimated_harvest_readiness IN ('NOT_READY', 'ALMOST_READY', 'READY', 'UNSURE'));

INSERT INTO public.operational_capacities (
  farm_id,
  capacity_type,
  capacity_value,
  capacity_unit,
  available_on,
  created_at,
  updated_at
)
SELECT
  farm_id,
  capacity_type,
  capacity_kg,
  'kg',
  available_on,
  created_at,
  updated_at
FROM public.postharvest_capacities;

INSERT INTO public.operational_capacities (
  farm_id,
  capacity_type,
  capacity_value,
  capacity_unit,
  available_on,
  created_at,
  updated_at
)
SELECT
  farm_id,
  'crate:' || crate_type,
  available_count,
  'count',
  available_on,
  created_at,
  updated_at
FROM public.crate_capacities;

DROP TABLE public.postharvest_capacities;
DROP TABLE public.crate_capacities;
DROP TABLE public.google_calendar_connections;
