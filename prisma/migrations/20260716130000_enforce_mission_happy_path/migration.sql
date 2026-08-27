ALTER TABLE public.missions
  ADD CONSTRAINT missions_status_happy_path_check
  CHECK (status IN ('ACTIVE', 'CLOSEOUT', 'COMPLETED'));

ALTER TABLE public.missions
  ADD CONSTRAINT missions_stage_happy_path_check
  CHECK (stage IN ('WAITING', 'HARVESTING', 'DRYING', 'FINISHED', 'TO_REVIEW', 'COMPLETED'));

ALTER TABLE public.mission_steps
  ADD CONSTRAINT mission_steps_status_happy_path_check
  CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED'));

ALTER TABLE public.mission_steps
  ADD CONSTRAINT mission_steps_stage_happy_path_check
  CHECK (stage IN ('HARVESTING', 'DRYING'));
