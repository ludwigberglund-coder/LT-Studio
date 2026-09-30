-- Recovered from live Supabase migration history (20260925081021 operator_admin_deny_direct_access).
-- GitHub is source of truth for rebuilds.


create policy "no direct authenticated access to platform operators"
on public.platform_operators for all to authenticated
using (false) with check (false);

create policy "no direct authenticated access to operator audit"
on public.operator_audit_events for all to authenticated
using (false) with check (false);
;
