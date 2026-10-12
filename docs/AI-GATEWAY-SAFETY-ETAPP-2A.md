# AI #774 – servergräns, etapp 2A

Status: **säkerhetskontrakt i kod, inte driftsatt Cloudflare-integration**.

Användaren har bekräftat att `CLOUDFLARE_ACCOUNT_ID` och `CLOUDFLARE_AI_TOKEN` sparats som Edge Function Secrets i **LT-Studio** (UAT), inte LT-Studio-Staging. Vi har inte läst tillbaka hemligheter eller exekverat ett riktigt modell-anrop. GitHub och publika klienten ska aldrig innehålla dem.

## Leverans

`packages/automation/ai-gateway-security.mjs` och `test/ai-gateway-security.test.js` introducerar ett oberoende serverkontrakt för framtida Edge Function:

- Begäranden får bara välja ett av tre fördefinierade **syntetiska scenarier** och idempotensnyckel. Fri text, dokument eller underlag avvisas.
- Den som anropar servern måste först verifiera användaren och den aktiva personliga sessionen via Supabase, AAL2/MFA och medlemskap i rätt företag. Modulen validerar dessa **inmatade verifieringsresultat**, men hämtar ännu inte själv sessionen från Supabase. Därför är den **inte** en autentiseringsgräns i sig.
- `readonly`, annat företag, annan användare och ogiltig session avvisas.
- Testunderlagets leverantör, moms och belopp kommer från en hårdkodad testmall och inte från användare eller AI.
- Ingen Cloudflare-begäran får göras före uttryckligt syntetiskt pilotgodkännande, integritetsgodkännande och en **beständig, atomär reservation** av budget/kvot. Reservationsfunktionen finns ännu inte och denna PR skapar ingen exekveringsväg.
- Ingen publik Supabase Edge Function, ingen deployment, inga data- eller huvudboksskrivningar. Ingen företagskund kan använda detta än.

## Följande saknas innan anslutning får aktiveras

1. En avgränsad Edge Function som verifierar riktig Supabase Auth, sessions-ID mot `auth.sessions` och företagets medlemskap med rätt roll. Lita aldrig på `verified:true` från klienten.
2. Atomär, serverbaserad kvotreservationsfunktion med globala och företagsspecifika tak, återanropsskydd och rate limit, med versionerad migration i GitHub och Supabase clean rebuild.
3. Feature-flag som är avstängd i UAT som standard och bara kan aktiveras för syntetiska testföretag.
4. Läs Cloudflare-token från Secrets **efter** alla kontroller. Inga riktiga kunddokument får gå ut.
5. Mockade fel- och integritetstester, aktivering i rätt miljö med återställningsplan, samt separat granskning av personuppgiftsskydd och modellvillkor.
6. Anslutning till befintlig automationskö utan direktbokföring. Allt måste gå via godkännandeflödena.

Kod- och säkerhetsförändringar hanteras enbart via GitHub PR och QA/CodeQL/Supabase rebuild. Relaterat #767, #771, #774.
