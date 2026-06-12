-- Permet reprendre el sorteig des d'on s'havia deixat (estat de reproducció persistit).

alter table public.sorteigs
  add column if not exists play_state jsonb;
