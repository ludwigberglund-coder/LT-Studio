-- Browser grants required by the Supabase customer register.
-- RLS + UAT AAL2 restrictive policy still decide which rows/actions are allowed.
-- DELETE is intentionally not granted: customer removal in UAT is archival.

grant insert,update on public.customers to authenticated;
revoke delete,truncate,references,trigger on public.customers from authenticated;
revoke all on public.customers from anon;
