-- Harden the already deployed automation review RPC.
-- The function itself checks auth.uid() and company membership, but anon should
-- not have EXECUTE privilege at all.

revoke all on function public.save_automation_proposal_review(text,text,jsonb) from public, anon;
grant execute on function public.save_automation_proposal_review(text,text,jsonb) to authenticated;
