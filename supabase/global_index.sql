-- Índice para el ranking GLOBAL escalable (getGlobalBoard).
-- Las consultas filtran por `day` y ordenan/filtran por `best_ms` (top 3,
-- conteo de "más rápidos que yo", vecinos ±1). Con muchos jugadores por día
-- este índice compuesto hace que todas esas consultas sean rápidas.
create index if not exists attempts_day_best_ms_idx
  on public.attempts (day, best_ms);
