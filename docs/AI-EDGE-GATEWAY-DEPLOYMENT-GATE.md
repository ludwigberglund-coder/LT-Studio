# AI Edge-gateway – avstängd integrationsstomme (#774)

Datum: 2026-10-13. Status: **inte distribuerad, inte aktiv, inga Cloudflare-anrop**.

Syfte: säkra kopplingen mellan mergad syntetisk provider/sessionkontroll och den atomära kvotreservationen från #787, utan att öppna en route eller aktivera piloten.

## Vad som nu finns i GitHub

- `supabase/functions/ai-bookkeeping-pilot/index.ts` är en framtida Supabase Edge Function.
- Den läser framtida Cloudflare-hemligheter enbart via `Deno.env` på serversidan. Inga hemliga värden visas eller versionsstyrs.
- Begärandegränsen kräver POST, högst 1 KiB JSON, tillåten HTTPS-origin, bearer-token, verifierad Supabase Auth-användare, AAL2, personlig `session_id` och användarscoperat företagsmedlemskap.
- Den versionerade `reserve_ai_pilot_request_server`-RPC:n får nu samtliga fem serverfält: företag, verifierad aktör, verifierad personlig session, request-id och saltad SHA-256-hash av klient-IP.
- Endast den fasta headern `x-real-ip` kan väljas genom exakt `AI_PILOT_TRUSTED_IP_HEADER=x-real-ip`. Ingen fallback till `x-forwarded-for`, `cf-connecting-ip` eller klientvald header finns. Ett separat hemligt `AI_PILOT_IP_HASH_SALT` på 32–256 tecken krävs; rå IP skickas inte till databasen.
- Förslaget stannar i status `manual-review`, lagras inte och bokförs inte. Ingen betalning, bank- eller verifikationsskrivning görs.
- Inga PDF-original, fakturabilder eller fritextpromptar tas emot, endast tre fördefinierade syntetiska testscenarier.

## Teknisk säkerhetsspärr

Funktionen har fortfarande två hårdkodade spärrar, `RELEASE_APPROVED = false` och `DURABLE_IP_LIMITER_VERIFIED = false`. De svarar `503 AI_PILOT_NOT_RELEASED` **innan** secrets, IP-header eller body läses och innan Cloudflare kan anropas. Supabase Secrets eller databasinställningar kan inte låsa upp revisionen.

**Funktionen är inte deployad**, och ingen `[functions.ai-bookkeeping-pilot]`-sektion finns i `supabase/config.toml`. Om revisionen ändå skulle distribueras av misstag är den inert.

## Måste vara klart före driftsättning

1. Verifiera i hosted syntetisk UAT att Supabase-gatewayn sätter och skriver över `x-real-ip`; testa uttryckligen att en klient inte kan förfalska headern. Byt inte `DURABLE_IP_LIMITER_VERIFIED` före dokumenterat bevis. Om detta inte kan bevisas ska annan betrodd plattformskälla väljas i en ny granskad PR.
2. Kör samtidiga dublett-/kvottester och tenanttest med två syntetiska företag, nekad roll, utgången/återkallad session och klientförsök att välja annat företags-ID.
3. Kör fullständigt Edge-paketerings-/distributionstest med relativa `packages/automation`-importer och explicit `verify_jwt = true`. Lägg först därefter till eventuell `config.toml`-sektion.
4. Verifiera att den centrala runtime-inställningen fortfarande är avstängd som standard och att databasfel, saknad salt/header och dublett blockerar leverantörsanrop fail-closed.
5. Inhämta explicit godkännande för dataskydd, leverantör, modelllicens och kostnadsgräns. Ingen betald fallback tillåts.
6. Quality/security, CodeQL och Supabase clean rebuild måste vara gröna. Ett separat releasebeslut krävs före deployment eller aktivering.

Därför ska Edge Function ännu inte anropas eller deployas. Användaren ska inte dela API-nycklar; de hanteras endast som Supabase Edge Secrets.

All utveckling går via GitHub PR. Runtime-data lagras i Supabase, aldrig i GitHub.
