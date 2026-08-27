ALTER TABLE public.buyer_commitments
  ADD CONSTRAINT buyer_commitments_farm_id_buyer_commitment_id_key UNIQUE (farm_id, buyer_commitment_id);

CREATE TABLE public.missions (
  mission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE,
  field_block_id uuid,
  crop_batch_id uuid,
  buyer_commitment_id uuid,
  status text NOT NULL DEFAULT 'DRAFT',
  original_message text NOT NULL,
  approved_plan_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, field_block_id) REFERENCES public.field_blocks(farm_id, field_block_id),
  FOREIGN KEY (farm_id, crop_batch_id) REFERENCES public.crop_batches(farm_id, crop_batch_id),
  FOREIGN KEY (farm_id, buyer_commitment_id) REFERENCES public.buyer_commitments(farm_id, buyer_commitment_id)
);

CREATE TABLE public.mission_messages (
  mission_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE public.mission_clarifications (
  mission_clarification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  key text NOT NULL,
  question text NOT NULL,
  answer text,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  answered_at timestamptz(6)
);

CREATE TABLE public.mission_constraints (
  mission_constraint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (mission_id, key)
);

CREATE TABLE public.planning_runs (
  planning_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  error text,
  trace_id text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  completed_at timestamptz(6)
);

CREATE TABLE public.plans (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  planning_run_id uuid NOT NULL REFERENCES public.planning_runs(planning_run_id) ON DELETE CASCADE,
  name text NOT NULL,
  summary text NOT NULL,
  recommended boolean NOT NULL DEFAULT false,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE public.plan_steps (
  plan_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(plan_id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  start_at timestamptz(6) NOT NULL,
  end_at timestamptz(6) NOT NULL,
  timezone text NOT NULL,
  is_conditional boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (plan_id, sequence)
);

CREATE TABLE public.mission_steps (
  mission_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  source_plan_step_id uuid NOT NULL,
  sequence integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  start_at timestamptz(6) NOT NULL,
  end_at timestamptz(6) NOT NULL,
  timezone text NOT NULL,
  is_conditional boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'SCHEDULED',
  calendar_sync_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  google_calendar_event_id text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (mission_id, sequence)
);

CREATE INDEX missions_farm_id_created_at_idx ON public.missions(farm_id, created_at);
CREATE INDEX mission_messages_mission_id_created_at_idx ON public.mission_messages(mission_id, created_at);
CREATE INDEX mission_clarifications_mission_id_status_idx ON public.mission_clarifications(mission_id, status);
CREATE INDEX planning_runs_mission_id_created_at_idx ON public.planning_runs(mission_id, created_at);
CREATE INDEX plans_mission_id_created_at_idx ON public.plans(mission_id, created_at);
