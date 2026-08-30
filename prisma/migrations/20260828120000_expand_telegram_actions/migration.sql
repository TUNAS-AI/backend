ALTER TABLE public.telegram_actions
ADD COLUMN payload jsonb,
ADD COLUMN external_message_id text;

CREATE UNIQUE INDEX telegram_actions_external_message_id_key
ON public.telegram_actions(external_message_id);
