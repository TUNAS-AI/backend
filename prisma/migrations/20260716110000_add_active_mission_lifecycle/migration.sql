ALTER TABLE public.missions
  ADD COLUMN stage text NOT NULL DEFAULT 'WAITING',
  ADD COLUMN notes text;

ALTER TABLE public.mission_constraints
  ADD COLUMN provenance text NOT NULL DEFAULT 'INFERRED',
  ADD COLUMN confidence text NOT NULL DEFAULT 'medium';

ALTER TABLE public.plan_steps
  ADD COLUMN stage text NOT NULL DEFAULT 'HARVESTING';

ALTER TABLE public.mission_steps
  ADD COLUMN stage text NOT NULL DEFAULT 'HARVESTING';

UPDATE public.missions
  SET status = 'ACTIVE', stage = 'WAITING'
  WHERE status = 'DRAFT';

CREATE TABLE public.mission_closeouts (
  mission_closeout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL UNIQUE REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  planned_harvest_kg numeric(14, 3) NOT NULL,
  planned_dried_kg numeric(14, 3) NOT NULL,
  actual_harvest_kg numeric(14, 3) NOT NULL,
  actual_dried_kg numeric(14, 3) NOT NULL,
  notes text,
  summary jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
