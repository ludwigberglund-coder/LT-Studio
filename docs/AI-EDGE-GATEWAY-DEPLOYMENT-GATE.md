# AI Edge-gateway – avstängd integrationsstomme (#774)

Datum: 2026-10-12. Status: **inte distribuerad, inte aktiv, inga Cloudflare-anrop**.

Syfte: nästa säkra steg efter mergade PR #771 (syntetisk Cloudflare-provider) och #776 (Supabase-sessions-/företagskontroll och orkestrering).

## Vad som levereras i denna PR

- `supabase/functions/ai-bookkeeping-pilot/index.ts` är en framtida Supabase Edge Function.
- Den skulle i sin slutliga version läsa Cloudflare-hemligheterna `CLOUDFLARE_ACCOUNT_ID` och `CLOUDFLARE_AI_TOKEN` via `Deno.env` på serversidan. Ägaren uppger att de ligger i befintligt `LT-Studio` i Supabase. Inga hemliga värden visas eller versionsstyrs.
- Dess begärandegräns kräver POST, minimalt JSON, tillåten HTTPS-origin, bearer-token, Supabase Auth och användarscoperat företagsmedlemskap via orkestreringen i `packages/automation/`.
- En framtida `reserve_ai_pilot_request_server`-RPC är **obligatorisk** och ska göra atomär, varaktig kvotreservations- och idempotenskontroll. Den finns **inte i databasen i nuläget**; därför saknas också aktivering.
- Den förbereder ett förslag med status `manual-review` men varken lagrar eller bokför det. Ingen betalning, ingen bank- eller verifikationsskrivning.
- Inga PDF-original, fakturabilder eller fritextpromptar tas emot – enbart tre syntetiska, fördefinierade testscenarier.

## Teknisk säkerhetsspärr

Funktionen har två hårdkodade spärrar, `RELEASE_APPROVED = false` och `DURABLE_IP_LIMITER_VERIFIED = false`, som svarar `503 AI_PILOT_NOT_RELEASED` **innan** secrets läses, body tolkas eller Cloudflare kan anropas. Man kan inte låsa upp detta bara genom att ändra en Supabase Secret eller ett inställningsvärde.

**Funktionen är inte deployad**, och ingen `[functions.ai-bookkeeping-pilot]`-sektion har tillkommit i `supabase/config.toml`. Det är avsiktligt. Om någon skulle driftsätta den felaktigt i detta läge är den ändå inert.

## Måste vara klart innan driftsättning

1. Ny versionerad SQL-migration med en skyddad, atomär, företags-/användar-/IP-/global kvot, idempotens, säker spärr efter gratiskvot och fail-closed vid DB-fel. Får inte skapa mer än en AI-begäran per unik begäran.
2. Klar och dokumenterad betrodd proxy/IP-källa enligt AGENTS.md. Lita aldrig på ett godtyckligt `x-forwarded-for` som användaren kan förfalska.
3. Fullständigt Edge-distributionstest inklusive korrekt paketering av de relativa `packages/automation`-importerna, specifik `verify_jwt = true`-konfiguration och endast syntetisk miljö. Om importpaketeringen inte stöds i Supabase ska den repareras i GitHub innan deployment.
4. Begränsning av HTTP-begäranden per IP och autentiserad användare i en uthållig servergräns, helst redan innan kostsamma anrop. Testa samtidiga dubbletter.
5. Säkerhetsgranskning av personliga sessioner och företagsisolering mot verkliga (men syntetiska) UAT-identiteter A/B, även efter logout.
6. Explicit godkännande av dataskydd, AI-leverantör och att testmodell/Cloudflare-plan fortfarande är kostnadsfri. Gratisgränsen 10 000 Neurons per dag är delad på Cloudflare-kontot.
7. Tester + CodeQL + Supabase clean rebuild + separat begränsad syntetisk pilot innan en användarknapp läggs till. Alltid mänsklig granskning före bokföring.

Därför ska ni **inte** försöka anropa eller deploya denna Edge Function ännu. För användaren är Cloudflare-konfigurationen klar som förberedelse; inget ytterligare manuellt moment behövs just nu.

All utveckling går via GitHub PR. Data lagras i Supabase, aldrig i GitHub.
