ALTER TABLE public.plan_steps ADD COLUMN action_kind text;
ALTER TABLE public.mission_steps ADD COLUMN action_kind text;

UPDATE public.plan_steps SET action_kind = CASE WHEN stage = 'HARVESTING' THEN 'HARVEST' ELSE 'INSPECT_DRYING' END;
UPDATE public.mission_steps SET action_kind = CASE WHEN stage = 'HARVESTING' THEN 'HARVEST' ELSE 'INSPECT_DRYING' END;

ALTER TABLE public.plan_steps ALTER COLUMN action_kind SET NOT NULL;
ALTER TABLE public.mission_steps ALTER COLUMN action_kind SET NOT NULL;
