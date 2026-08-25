-- Reset only Hijau AI application state. Supabase identities and configuration are preserved.
DROP TABLE IF EXISTS public.activity_updates CASCADE;
DROP TABLE IF EXISTS public.authoritative_events CASCADE;
DROP TABLE IF EXISTS public.buyer_commitments CASCADE;
DROP TABLE IF EXISTS public.calendar_outbox CASCADE;
DROP TABLE IF EXISTS public.content_objects CASCADE;
DROP TABLE IF EXISTS public.conversation_messages CASCADE;
DROP TABLE IF EXISTS public.crop_batches CASCADE;
DROP TABLE IF EXISTS public.evidence CASCADE;
DROP TABLE IF EXISTS public.farm_context_records CASCADE;
DROP TABLE IF EXISTS public.farms CASCADE;
DROP TABLE IF EXISTS public.field_blocks CASCADE;
DROP TABLE IF EXISTS public.mission_outcomes CASCADE;
DROP TABLE IF EXISTS public.mission_plans CASCADE;
DROP TABLE IF EXISTS public.mission_step_dependencies CASCADE;
DROP TABLE IF EXISTS public.mission_steps CASCADE;
DROP TABLE IF EXISTS public.missions CASCADE;
DROP TABLE IF EXISTS public.pipeline_commands CASCADE;
DROP TABLE IF EXISTS public.pipeline_runs CASCADE;
DROP TABLE IF EXISTS public.pipeline_triggers CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.yield_quality_patterns CASCADE;

DROP TYPE IF EXISTS public.approval_status CASCADE;
DROP TYPE IF EXISTS public.mission_status CASCADE;
DROP TYPE IF EXISTS public.outbox_status CASCADE;
DROP TYPE IF EXISTS public.step_status CASCADE;
