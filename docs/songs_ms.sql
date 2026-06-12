-- Converteix els talls de la taula songs de segons a mil·lisegons, per més precisió.

update public.songs set in_bingo = in_bingo * 1000 where in_bingo is not null;
update public.songs set out_bingo = out_bingo * 1000 where out_bingo is not null;
