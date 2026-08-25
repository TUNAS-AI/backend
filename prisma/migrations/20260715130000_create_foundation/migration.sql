CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text UNIQUE,
  display_name text,
  locale text NOT NULL DEFAULT 'id',
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE public.farms (
  farm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES public.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  default_working_hours jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE public.field_blocks (
  field_block_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  name text NOT NULL,
  area_hectares numeric(12, 4),
  location_reference text,
  access_notes text,
  drainage_notes text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (farm_id, name),
  UNIQUE (farm_id, field_block_id)
);

CREATE INDEX field_blocks_farm_id_idx ON public.field_blocks (farm_id);

CREATE TABLE public.crop_batches (
  crop_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  field_block_id uuid NOT NULL,
  crop text NOT NULL,
  variety text,
  planting_date date,
  crop_stage text,
  harvest_round integer NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (farm_id, crop_batch_id),
  UNIQUE (farm_id, field_block_id, crop_batch_id),
  FOREIGN KEY (farm_id, field_block_id) REFERENCES public.field_blocks (farm_id, field_block_id) ON DELETE CASCADE
);

CREATE INDEX crop_batches_farm_id_field_block_id_idx ON public.crop_batches (farm_id, field_block_id);
CREATE INDEX crop_batches_field_block_id_idx ON public.crop_batches (field_block_id);

CREATE TABLE public.field_observations (
  field_observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  field_block_id uuid NOT NULL,
  crop_batch_id uuid,
  observation_type text NOT NULL,
  observed_at timestamptz(6) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, field_block_id) REFERENCES public.field_blocks (farm_id, field_block_id) ON DELETE CASCADE,
  FOREIGN KEY (farm_id, crop_batch_id) REFERENCES public.crop_batches (farm_id, crop_batch_id) ON DELETE CASCADE,
  FOREIGN KEY (farm_id, field_block_id, crop_batch_id) REFERENCES public.crop_batches (farm_id, field_block_id, crop_batch_id) ON DELETE CASCADE
);

CREATE INDEX field_observations_farm_id_observed_at_idx ON public.field_observations (farm_id, observed_at);
CREATE INDEX field_observations_field_block_id_observed_at_idx ON public.field_observations (field_block_id, observed_at);
CREATE INDEX field_observations_crop_batch_id_observed_at_idx ON public.field_observations (crop_batch_id, observed_at);

CREATE TABLE public.operational_capacities (
  operational_capacity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  capacity_type text NOT NULL,
  capacity_value numeric(14, 3) NOT NULL,
  capacity_unit text NOT NULL,
  available_on date NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX operational_capacities_farm_id_available_on_idx ON public.operational_capacities (farm_id, available_on);

CREATE TABLE public.worker_availability_windows (
  worker_availability_window_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  worker_name text,
  starts_at timestamptz(6) NOT NULL,
  ends_at timestamptz(6) NOT NULL,
  worker_count integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (worker_count > 0)
);

CREATE INDEX worker_availability_windows_farm_id_starts_at_idx ON public.worker_availability_windows (farm_id, starts_at);

CREATE TABLE public.postharvest_capacities (
  postharvest_capacity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  capacity_type text NOT NULL,
  capacity_kg numeric(14, 3) NOT NULL,
  available_on date NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX postharvest_capacities_farm_id_available_on_idx ON public.postharvest_capacities (farm_id, available_on);

CREATE TABLE public.crate_capacities (
  crate_capacity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  crate_type text NOT NULL,
  available_count integer NOT NULL,
  available_on date NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (available_count >= 0)
);

CREATE INDEX crate_capacities_farm_id_available_on_idx ON public.crate_capacities (farm_id, available_on);

CREATE TABLE public.buyer_commitments (
  buyer_commitment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  crop_batch_id uuid NOT NULL,
  buyer_name text NOT NULL,
  quantity_kg numeric(14, 3) NOT NULL,
  target_grade text,
  deadline timestamptz(6) NOT NULL,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (quantity_kg > 0),
  FOREIGN KEY (farm_id, crop_batch_id) REFERENCES public.crop_batches (farm_id, crop_batch_id) ON DELETE CASCADE
);

CREATE INDEX buyer_commitments_farm_id_deadline_idx ON public.buyer_commitments (farm_id, deadline);
CREATE INDEX buyer_commitments_crop_batch_id_deadline_idx ON public.buyer_commitments (crop_batch_id, deadline);

CREATE TABLE public.weather_snapshots (
  weather_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  field_block_id uuid NOT NULL,
  source text NOT NULL,
  observed_at timestamptz(6) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, field_block_id) REFERENCES public.field_blocks (farm_id, field_block_id) ON DELETE CASCADE
);

CREATE INDEX weather_snapshots_farm_id_observed_at_idx ON public.weather_snapshots (farm_id, observed_at);
CREATE INDEX weather_snapshots_field_block_id_observed_at_idx ON public.weather_snapshots (field_block_id, observed_at);

CREATE TABLE public.google_calendar_connections (
  google_calendar_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL UNIQUE REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  calendar_id text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz(6),
  scopes text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

INSERT INTO public.users (id, email, display_name)
SELECT
  id,
  email,
  COALESCE(
    NULLIF(raw_user_meta_data ->> 'full_name', ''),
    NULLIF(raw_user_meta_data ->> 'name', ''),
    NULLIF(raw_user_meta_data ->> 'user_name', '')
  )
FROM auth.users
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'user_name', '')
    )
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
