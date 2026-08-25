DELETE FROM public.field_blocks
WHERE latitude IS NULL OR longitude IS NULL;

ALTER TABLE public.field_blocks
  ALTER COLUMN latitude SET NOT NULL,
  ALTER COLUMN longitude SET NOT NULL;
