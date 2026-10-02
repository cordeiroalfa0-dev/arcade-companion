CREATE OR REPLACE FUNCTION public.mga_upsert_save(
  p_user_id UUID,
  p_rom TEXT,
  p_core TEXT,
  p_state_b64 TEXT,
  p_preview TEXT,
  p_saved_at BIGINT,
  p_date_str TEXT
)
RETURNS TABLE(stored BOOLEAN, saved_at BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_saved_at BIGINT;
BEGIN
  INSERT INTO public.mga_saves(user_id, rom, core, state_b64, preview, saved_at, date_str)
  VALUES (p_user_id, p_rom, p_core, p_state_b64, p_preview, p_saved_at, p_date_str)
  ON CONFLICT (user_id, rom, core) DO UPDATE SET
    state_b64 = EXCLUDED.state_b64,
    preview = EXCLUDED.preview,
    saved_at = EXCLUDED.saved_at,
    date_str = EXCLUDED.date_str
    WHERE public.mga_saves.saved_at < EXCLUDED.saved_at
       OR (public.mga_saves.saved_at = EXCLUDED.saved_at
           AND public.mga_saves.state_b64 = EXCLUDED.state_b64)
  RETURNING saved_at INTO stored_saved_at;

  IF stored_saved_at IS NULL THEN
    SELECT s.saved_at INTO stored_saved_at
      FROM public.mga_saves AS s
     WHERE s.user_id = p_user_id AND s.rom = p_rom AND s.core = p_core;
    RETURN QUERY SELECT FALSE, stored_saved_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, stored_saved_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mga_upsert_save(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mga_upsert_save(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
