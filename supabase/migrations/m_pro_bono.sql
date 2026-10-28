-- SLATE OS · pro bono projects (28 Oct 2026)
-- "Pro bono" is kept with the agreement details, which only the Principal and the COO can read.
-- Run in Supabase › SQL Editor. Safe to run more than once.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('private.docs_split_agreement'::regproc);
  if position('''proBono''' in d) = 0 then
    if position($o$array['agStatus','agDate','agRef','docUrl']$o$ in d) = 0 then raise exception 'docs_split_agreement has changed; update this migration'; end if;
    d := replace(d, $o$array['agStatus','agDate','agRef','docUrl']$o$, $n$array['agStatus','agDate','agRef','docUrl','proBono']$n$);
    execute d;
  end if;
end $mig$;
