CREATE TABLE public.google_calendar_connections (
  google_calendar_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL UNIQUE REFERENCES public.farms (farm_id) ON DELETE CASCADE,
  calendar_id text NOT NULL DEFAULT 'primary',
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  token_expires_at timestamptz(6) NOT NULL,
  scopes text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);
