-- Applied to Supabase project LT-Studio as migration 20260924212023.
-- GitHub remains Source of Truth for the migration definition.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
