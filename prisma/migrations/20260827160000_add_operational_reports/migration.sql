ALTER TABLE public.missions ADD COLUMN revision integer NOT NULL DEFAULT 1;

CREATE TABLE public.operational_reports (
  operational_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(farm_id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
  mission_step_id uuid REFERENCES public.mission_steps(mission_step_id),
  field_block_id uuid REFERENCES public.field_blocks(field_block_id),
  crop_batch_id uuid REFERENCES public.crop_batches(crop_batch_id),
  operational_interaction_id uuid NOT NULL REFERENCES public.operational_interactions(operational_interaction_id),
  channel text NOT NULL,
  report_type text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  narrative text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  supersedes_report_id uuid REFERENCES public.operational_reports(operational_report_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_reports_farm_id_mission_id_accepted_at_idx ON public.operational_reports(farm_id, mission_id, accepted_at);
CREATE INDEX operational_reports_mission_step_id_accepted_at_idx ON public.operational_reports(mission_step_id, accepted_at);
CREATE INDEX operational_reports_supersedes_report_id_idx ON public.operational_reports(supersedes_report_id);
