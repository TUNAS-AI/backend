ALTER TABLE public.plans
  ADD COLUMN drying_estimate_days numeric(5, 2) NOT NULL DEFAULT 1,
  ADD COLUMN drying_estimate_reason text NOT NULL DEFAULT 'Legacy plan migration';

ALTER TABLE public.plan_steps
  RENAME COLUMN start_at TO starts_on;

ALTER TABLE public.plan_steps
  RENAME COLUMN end_at TO ends_on;

ALTER TABLE public.plan_steps
  ALTER COLUMN starts_on TYPE date USING starts_on::date,
  ALTER COLUMN ends_on TYPE date USING ends_on::date,
  ADD COLUMN schedule_type text NOT NULL DEFAULT 'DAILY_WINDOW',
  ADD COLUMN window_start text,
  ADD COLUMN window_end text;

UPDATE public.plan_steps
  SET window_start = '00:00', window_end = '23:59';

ALTER TABLE public.mission_steps
  RENAME COLUMN start_at TO starts_on;

ALTER TABLE public.mission_steps
  RENAME COLUMN end_at TO ends_on;

ALTER TABLE public.mission_steps
  ALTER COLUMN starts_on TYPE date USING starts_on::date,
  ALTER COLUMN ends_on TYPE date USING ends_on::date,
  ADD COLUMN schedule_type text NOT NULL DEFAULT 'DAILY_WINDOW',
  ADD COLUMN window_start text,
  ADD COLUMN window_end text;

UPDATE public.mission_steps
  SET window_start = '00:00', window_end = '23:59';

ALTER TABLE public.plan_steps
  ADD CONSTRAINT plan_steps_schedule_type_check CHECK (schedule_type IN ('DAILY_WINDOW', 'DATE_RANGE'));

ALTER TABLE public.mission_steps
  ADD CONSTRAINT mission_steps_schedule_type_check CHECK (schedule_type IN ('DAILY_WINDOW', 'DATE_RANGE'));
