# AI-pilot: korbar anslutningsrepetition i staging

Sparar #774, #797 och #823. Detta ar ett operatorverktyg, inte aktivering av PR #826.

## Vad som ar implementerat

`scripts/ai-pilot-staging-smoke.mjs` anvander den befintliga AI-gatewayens tre fasta scenarier och det befintliga forslagskontraktet. Ingen separat bokforingsmotor, modellendpoint, prompteditor, dokumentuppladdning eller ekonomisk skrivfunktion tillkommer.

- Enda destinationen ar `https://rwnqkgbbbxjjfhwtepsi.supabase.co/functions/v1/ai-bookkeeping-pilot`.
- Vanliga portalen ar fortfarande UAT (`bwbhnotpuuhgghjpmflk`); byt inte dess konfiguration till staging och anvand inte dess session i testet.
- Utan `--run` sker inget natverksanrop och inga credentials lases.
- Aven med `--run` kravs att de BEFINTLIGA versionsstyrda server- och browserflaggorna ar true. Verktyget andrar dem inte, och det finns ingen ny miljo-/CLI-flagga som oppnar dessa las.
- Dessa lokala flaggkontroller ar bara misstagsskydd, inte bevis pa en review, granskad commit eller deployad version. Operatoren maste folja #826:s separata releaseprocess. Den riktiga servern ansvarar alltid for Auth/getUser, aktuell personlig session, MFA, RLS, roll och bestandig kvot.
- En lokal JWT-kontroll avvisar uppenbara fel (bland annat UAT-issuer, AAL1, service-role och utgangen token). JWT-dekodning ar INTE signaturverifiering eller autentisering.
- Publicerbar nyckel plus en personlig staging-session anvands. Service-role, Cloudflare-token och management-token anvands aldrig av klienten.
- Ett explicit kommando kan skicka hogst ett anrop. Inga retries, fallbackmodeller eller automatiska serier.
- Svar begransas under lasning till 8192 byte och 15 sekunder inklusive headers/body. Redirects avvisas; feltexter fran externa system loggas inte.
- HTTP 200 ensamt racker inte. Ratt foretag/request-id/scenario, exakt modellidentitet, testdatum, konto, hela tre-raderskonteringen och granskningsmarkorer kontrolleras oberoende. Belopp hamtas fran befintliga syntetiska testkontrakt, inte fran modellens egen sakerhetsbedomning.
- Rapporten innehaller bara fasta tekniska statusfalt och syntetiskt request-id. Token, anvandar-/foretagsidentitet, headers, modellens fritext och rakropp skrivs aldrig ut.

## Saker kontroll nu

Kor med repositoryts Node-version (CI anvander Node 24):

```sh
node scripts/ai-pilot-staging-smoke.mjs --plan
```

Pa nuvarande lasta main ska resultatet vara `AI_PILOT_NOT_RELEASED`, `liveAttempted=false`, `responseVerified=false` och exitkod 1. Det ar ett verifierat stopp, inte ett lyckat AI-anrop. `--run` far inte heller kontakta natverket i detta lage.

## Forst EFTER separat godkand release enligt PR #826

En behorig operator och oberoende granskare ska ha bekraftat staging, exakt godkand kallversion, CI, migrationer, funktionsparitet, secret-konfiguration, kvoter och rollback. Detta dokument ger inte det godkannandet.

Operatorens privata secrets-/sessionshantering tillhandahaller foljande processmiljo. Lagg aldrig vardena i chatt, GitHub, kommandoargument, shellhistorik, artifacts eller en committad fil:

| Namn | Innehall |
| --- | --- |
| `AI_PILOT_STAGING_PROJECT_REF` | Exakt `rwnqkgbbbxjjfhwtepsi` |
| `AI_PILOT_STAGING_PUBLISHABLE_KEY` | Projektets moderna publicerbara `sb_publishable_...`-nyckel |
| `AI_PILOT_STAGING_ACCESS_TOKEN` | Kortlivad personlig staging-session efter riktig inloggning och MFA |
| `AI_PILOT_STAGING_COMPANY_ID` | Det pahittade staging-foretagets befintliga ID |

Ingen session far fabriceras med SQL, inget MFA-skydd far stangas av och ingen token ska skickas till ChatGPT for att kora testet.

```sh
node scripts/ai-pilot-staging-smoke.mjs --run --scenario office-paper
```

Tillatna scenarier: `office-paper`, `software-service`, `cleaning-supplies`. Skicka bara ett fall i taget inom redan godkanda kvoter. Den gemensamma planerade bucketen ar 2 anrop per 600 sekunder och den befintliga anvandarkvoten 2 per dag: forsok inte kora alla tre samtidigt eller hoj kvoter for att fa ett test att passera.

Anvand `--request-id ai-pilot-smoke-<UUIDv4>` med samma redan antecknade syntetiska ID vid en separat godkand replaykontroll. Det maste vara ett faktiskt UUIDv4, inte den bokstavliga platshallaren. Utelamnat ID genereras en gang och finns i rapporten. Om processen avbryts innan rapporten kommit: starta inte om med ett nytt ID utan att forst stammas av mot operatorens testprotokoll. Ingen automatisk replay eller forbrukningskontroll utlovas i klienten; serverns idempotens och kvoter maste vara verifierade.

Rapportens `liveAttempted` betyder att klienten har forsokt kontakta Edge Function, INTE att Cloudflare anropats. `responseVerified=true` betyder bara att det mottagna syntetiska forslaget klarade kontraktskontrollen. `releaseAuthorized` ar alltid false: verktyget ger aldrig ett releasegodkannande. Ett godkant svar ersatter inte kontroller av parallellanrop, kvoter, revokerade sessioner, faktisk modellforbrukning eller oforandrad huvudbok/bank. Dokumentera dessa separat enligt #826.

## Observerad miljo 2026-10-17

Read-only Supabase-kontroll: staging ar ACTIVE_HEALTHY. Ingen `ai-bookkeeping-pilot` ar installerad. `ai_pilot_runtime_settings.enabled=false`; dagstak ar 2/anvandare, 5/foretag och 20/globalt. `ai_pilot_admission_state` och `admit_ai_pilot_request_server()` saknas fortfarande. Inga credentials, modell-anrop eller databasskrivningar gjordes av denna forkontroll. Ingen oberoende review finns pa #826 vid kontrollen.

Nuvarande connector har inga atgarder for Edge-secret-namn eller -skrivning. Vi har inte verifierat att Cloudflare-konfigurationen finns i staging; anvandarens tidigare uppgift gallde LT-Studio/UAT. Ny kontroll av faktiska namn kravs via behorig administrators Dashboard, utan aterlasning av varden. Dessa hinder ar inte losta av testverktyget.

## Automatiska tester

`node --test test/ai-pilot-staging-smoke.test.js` utovar klienten med enbart simulerad transport och syntetiska sessioner, inklusive avstangd release, fel miljo, felaktiga credentials, fel svar, hemlighetsskydd, replay-ID, redirects och hangande transport. Inget live-anrop sker i CI. Separat lokal kontraktskoring: 28/28 nya tester och 85/85 tillsammans med befintliga provider-, gateway-, session-, svars- och #826-HTTP-tester pa dess verifierade kallexport. Detta ar INTE hosted end-to-end- eller Cloudflare-bevis.

GitHub main/PR/CI ar sanningskalla. Tillfalliga kallelsexporter anvands bara for tester; ingen alternativ lokal projektbas skapas. Merge/publicering rapporteras forst efter verklig verifiering pa PR:n. Bank-PR #802 och AI-release-PR #826 ingar inte i denna leverans.
