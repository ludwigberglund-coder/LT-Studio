// Cloudflare AI pilot gateway. This revision is released only for the isolated synthetic staging pilot.
// Runtime settings, Auth/MFA, tenant checks and durable quotas still gate every call.
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createSyntheticHttpHandler } from "../../../packages/automation/ai-synthetic-http.mjs";

const RELEASE_APPROVED = true;

const handler = createSyntheticHttpHandler({
  createClient,
  env: (name: string) => Deno.env.get(name) || "",
  releaseApproved: RELEASE_APPROVED
});

Deno.serve(handler);
