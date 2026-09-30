-- Final cutover: the browser must use the JWT-verified Edge Function.
-- After this migration signed-in browser users can no longer execute the
-- SECURITY DEFINER staging RPC directly through the public Data API.

revoke execute on function public.stage_manual_customer_payment(text,text,text,date,bigint,text,text,text)
  from authenticated;
