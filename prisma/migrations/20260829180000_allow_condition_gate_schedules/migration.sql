ALTER TABLE public.plan_steps
  DROP CONSTRAINT plan_steps_schedule_type_check,
  ADD CONSTRAINT plan_steps_schedule_type_check
    CHECK (schedule_type IN ('DAILY_WINDOW', 'DATE_RANGE', 'CONDITION_GATE'));

ALTER TABLE public.mission_steps
  DROP CONSTRAINT mission_steps_schedule_type_check,
  ADD CONSTRAINT mission_steps_schedule_type_check
    CHECK (schedule_type IN ('DAILY_WINDOW', 'DATE_RANGE', 'CONDITION_GATE'));
