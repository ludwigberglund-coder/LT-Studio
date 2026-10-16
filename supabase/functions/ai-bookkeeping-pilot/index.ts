// Cloudflare AI pilot gateway. This revision remains inert until a reviewed
// code change flips RELEASE_APPROVED; environment variables cannot unlock it.
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createSyntheticHttpHandler } from "../../../packages/automation/ai-synthetic-http.mjs";

const RELEASE_APPROVED = false;

const handler = createSyntheticHttpHandler({
  createClient,
  env: (name: string) => Deno.env.get(name) || "",
  releaseApproved: RELEASE_APPROVED
});

Deno.serve(handler);
