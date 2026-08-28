CREATE TABLE public.tunas_messages (
  tunas_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE,
  mission_id uuid REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  kind text NOT NULL,
  role text NOT NULL DEFAULT 'assistant',
  content text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, dedupe_key)
);
CREATE INDEX tunas_messages_farm_id_created_at_idx ON public.tunas_messages(farm_id, created_at);

CREATE TABLE public.tunas_forecast_checks (
  tunas_forecast_check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, forecast_date)
);
