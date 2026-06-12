-- Fix: el DELETE des del client (rol "anon") es bloquejava silenciosament per RLS,
-- per aixo els bingos esborrats reapareixien. Afegim politiques DELETE
-- equivalents a les d'UPDATE/INSERT que ja existeixen per a aquestes taules.

drop policy if exists "anon delete sorteigs" on public.sorteigs;
create policy "anon delete sorteigs"
  on public.sorteigs
  for delete
  to anon
  using (true);

drop policy if exists "anon delete sorteig_items" on public.sorteig_items;
create policy "anon delete sorteig_items"
  on public.sorteig_items
  for delete
  to anon
  using (true);

drop policy if exists "anon delete tickets" on public.tickets;
create policy "anon delete tickets"
  on public.tickets
  for delete
  to anon
  using (true);
