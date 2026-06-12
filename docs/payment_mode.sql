-- Mode "pagament" per sorteigs: QR individuals d'un sol ús per butlleta.

alter table public.sorteigs
  add column if not exists payment_mode boolean not null default false;

alter table public.tickets
  add column if not exists code text,
  add column if not exists card_number integer,
  add column if not exists claimed_at timestamptz;

create unique index if not exists tickets_code_key on public.tickets (code) where code is not null;

-- Re-afirmar permisos anon sobre tickets (select/insert/update) per al flux
-- de generar QR (insert), llegir-lo per codi (select) i marcar-lo com
-- bescanviat / actualitzar marcades (update). Idempotent.
drop policy if exists "anon select tickets" on public.tickets;
create policy "anon select tickets"
  on public.tickets
  for select
  to anon
  using (true);

drop policy if exists "anon insert tickets" on public.tickets;
create policy "anon insert tickets"
  on public.tickets
  for insert
  to anon
  with check (true);

drop policy if exists "anon update tickets" on public.tickets;
create policy "anon update tickets"
  on public.tickets
  for update
  to anon
  using (true)
  with check (true);
