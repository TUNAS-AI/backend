CREATE TABLE public.operational_threads (
  operational_thread_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE,
  mission_id uuid REFERENCES public.missions(mission_id) ON DELETE CASCADE, channel text NOT NULL, status text NOT NULL DEFAULT 'OPEN',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_threads_farm_id_channel_updated_at_idx ON public.operational_threads(farm_id, channel, updated_at);

CREATE TABLE public.operational_interactions (
  operational_interaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operational_thread_id uuid NOT NULL REFERENCES public.operational_threads(operational_thread_id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE, mission_id uuid REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  channel text NOT NULL, external_message_id text NOT NULL, message text NOT NULL, trigger text, status text NOT NULL DEFAULT 'RECEIVED', response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(farm_id, channel, external_message_id)
);
CREATE INDEX operational_interactions_operational_thread_id_created_at_idx ON public.operational_interactions(operational_thread_id, created_at);

CREATE TABLE public.pending_actions (
  pending_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operational_thread_id uuid NOT NULL REFERENCES public.operational_threads(operational_thread_id) ON DELETE CASCADE,
  operational_interaction_id uuid NOT NULL REFERENCES public.operational_interactions(operational_interaction_id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE, mission_id uuid REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  kind text NOT NULL, status text NOT NULL DEFAULT 'PENDING', preview jsonb NOT NULL, expected_state jsonb, resolution jsonb, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX pending_actions_operational_thread_id_status_created_at_idx ON public.pending_actions(operational_thread_id, status, created_at);
CREATE INDEX pending_actions_farm_id_status_idx ON public.pending_actions(farm_id, status);

CREATE TABLE public.operational_events (
  operational_event_id bigserial PRIMARY KEY, operational_thread_id uuid NOT NULL REFERENCES public.operational_threads(operational_thread_id) ON DELETE CASCADE,
  operational_interaction_id uuid REFERENCES public.operational_interactions(operational_interaction_id) ON DELETE CASCADE,
  pending_action_id uuid REFERENCES public.pending_actions(pending_action_id) ON DELETE CASCADE, farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE,
  mission_id uuid REFERENCES public.missions(mission_id) ON DELETE CASCADE, actor text NOT NULL, channel text NOT NULL, type text NOT NULL,
  before jsonb, after jsonb, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_events_mission_id_created_at_operational_event_id_idx ON public.operational_events(mission_id, created_at, operational_event_id);
CREATE INDEX operational_events_operational_thread_id_created_at_idx ON public.operational_events(operational_thread_id, created_at);

-- The official LangGraph Postgres saver owns and migrates its checkpoint tables at process startup.
