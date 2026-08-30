ALTER TABLE public.planning_runs
  ADD COLUMN input_snapshot jsonb,
  ADD COLUMN input_hash text,
  ADD COLUMN solver_version text,
  ADD COLUMN objective_ordering jsonb,
  ADD COLUMN tie_break_ordering jsonb;

ALTER TABLE public.plan_steps
  ADD COLUMN quantity_kg numeric(14,3),
  ADD COLUMN dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN resource_demands jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mission_steps
  ADD COLUMN quantity_kg numeric(14,3),
  ADD COLUMN dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN resource_demands jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN actual_started_at timestamptz,
  ADD COLUMN actual_completed_at timestamptz,
  ADD COLUMN actual_quantity_kg numeric(14,3);

ALTER TABLE public.weather_snapshots
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN horizon_starts_at timestamptz,
  ADD COLUMN horizon_ends_at timestamptz;
