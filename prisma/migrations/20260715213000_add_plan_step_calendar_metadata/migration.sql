ALTER TABLE public.plan_steps
  ADD COLUMN calendar_sync_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN google_calendar_event_id text;
