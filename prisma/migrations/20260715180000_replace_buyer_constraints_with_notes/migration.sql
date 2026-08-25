ALTER TABLE public.buyer_commitments
  ADD COLUMN notes text;

UPDATE public.buyer_commitments
SET notes = CASE jsonb_typeof(constraints)
  WHEN 'array' THEN NULLIF((
    SELECT string_agg(item.value, E'\n')
    FROM jsonb_array_elements_text(constraints) AS item(value)
  ), '')
  WHEN 'string' THEN constraints #>> '{}'
  ELSE NULL
END;

ALTER TABLE public.buyer_commitments
  DROP COLUMN constraints;
