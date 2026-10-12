# AI #774 – servergräns, etapp 2A

Status: **säkerhetskontrakt i kod, inte driftsatt Cloudflare-integration**.

Användaren har bekräftat att `CLOUDFLARE_ACCOUNT_ID` och `CLOUDFLARE_AI_TOKEN` sparats som Edge Function Secrets i **LT-Studio** (UAT), inte LT-Studio-Staging. Vi har inte läst tillbaka hemligheter eller exekverat ett riktigt modell-anrop. GitHub och publika klienten ska aldrig innehålla dem.

## Leverans

`packages/automation/ai-gateway-security.mjs`, `packages/automation/ai-gateway-session.mjs` och tillhörande `test/ai-gateway-*.test.js` introducerar ett oberoende serverkontrakt för framtida Edge Function:

- Begäranden får bara välja ett av tre fördefinierade **syntetiska scenarier** och idempotensnyckel. Fri text, dokument eller underlag avvisas.
- Preflightmodulen har nu även ett separat asynkront lager som begär `auth.getUser(accessToken)` från Supabase Auth, kontrollerar AAL2/personligt `session_id` i det **redan verifierade** JWT:t och läser `company_memberships` med en **användarscoperad Supabase-klient**. Den befintliga restriktiva RLS-policyn blockerar ogiltiga/återkallade sessioner när medlemskapet läses. För en säker implementering måste serverns klient verkligen ha `Authorization: Bearer <samma token>`; det är INTE säkert att använda service-role för medlemskapsfrågan. Detta är fortfarande en adapter och **ingen HTTP-route eller live-testad session**.
- `readonly`, annat företag, annan användare och ogiltig session avvisas.
- Testunderlagets leverantör, moms och belopp kommer från en hårdkodad testmall och inte från användare eller AI.
- Ingen Cloudflare-begäran får göras före uttryckligt syntetiskt pilotgodkännande, integritetsgodkännande och en **beständig, atomär reservation** av budget/kvot. Reservationsfunktionen finns ännu inte och denna PR skapar ingen exekveringsväg.
- Ingen publik Supabase Edge Function, ingen deployment, inga data- eller huvudboksskrivningar. Ingen företagskund kan använda detta än.

## Följande saknas innan anslutning får aktiveras

1. En avgränsad Edge Function som konstruerar rätt användarscoperad klient och anropar preflight. Integrationsverifiera riktig Supabase Auth samt RLS-spärr mot `auth.sessions`, ogiltiga MFA-sessioner och rätt företagsroll. Lita aldrig på `verified:true` från klienten.
2. Atomär, serverbaserad kvotreservationsfunktion med globala och företagsspecifika tak, återanropsskydd och rate limit, med versionerad migration i GitHub och Supabase clean rebuild.
3. Feature-flag som är avstängd i UAT som standard och bara kan aktiveras för syntetiska testföretag.
4. Läs Cloudflare-token från Secrets **efter** alla kontroller. Inga riktiga kunddokument får gå ut.
5. Mockade fel- och integritetstester, aktivering i rätt miljö med återställningsplan, samt separat granskning av personuppgiftsskydd och modellvillkor.
6. Anslutning till befintlig automationskö utan direktbokföring. Allt måste gå via godkännandeflödena.

Kod- och säkerhetsförändringar hanteras enbart via GitHub PR och QA/CodeQL/Supabase rebuild. Relaterat #767, #771, #774.

## Verifiering mot ansluten LT-Studio Supabase (read-only)

Databasens faktiska `public.company_memberships` RLS har en permissiv policy för användarens eget `auth_user_id` och en **restriktiv** policy `UAT requires AAL2`, som använder `lt_security.request_has_aal2_personal_session()`. Den i sin tur anropar `lt_security.session_within_personal_limit()`, som slår upp den personliga sessionen i `auth.sessions` och kontrollerar att användaren inte är avstängd och inte har passerat sin personliga tidsgräns. Denna metadata verifierades med read-only SQL, inga data/schema ändrades. `ai-gateway-session.mjs` ska alltid läsa medlemskap via en användarscoperad klient och aldrig via service-role. Verifiering av verkliga testidentiteter återstår.
