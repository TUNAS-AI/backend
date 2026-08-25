ALTER TABLE public.field_blocks
  ADD COLUMN latitude numeric(9, 6),
  ADD COLUMN longitude numeric(9, 6),
  ADD COLUMN notes text,
  ADD CONSTRAINT field_blocks_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT field_blocks_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

UPDATE public.field_blocks
SET notes = NULLIF(concat_ws(E'\n\n',
  CASE WHEN location_reference IS NULL THEN NULL ELSE 'Location reference: ' || location_reference END,
  CASE WHEN access_notes IS NULL THEN NULL ELSE 'Access: ' || access_notes END,
  CASE WHEN drainage_notes IS NULL THEN NULL ELSE 'Drainage: ' || drainage_notes END
), '');

ALTER TABLE public.field_blocks
  DROP COLUMN location_reference,
  DROP COLUMN access_notes,
  DROP COLUMN drainage_notes;
