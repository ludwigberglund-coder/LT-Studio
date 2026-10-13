# AI-bokföring – framtidssäkert förslagskontrakt och införandeordning

Status: **designkontrakt, inte körande funktion eller godkänd bokföring**. Datum: 2026-10-13. Förankrat i #767 och #774. Aktuell kod, `AGENTS.md` och `docs/CURRENT-ARCHITECTURE.md` har företräde.

## Varför detta behövs

Första piloten använder syntetiska leverantörsfakturor och Cloudflare Workers AI. Vi vill kunna förbättra modellen, byta leverantör, hantera fler företag och få AI-förslag i dokumentinkorg, automation och bokslut utan att skapa olika bokföringssystem. En AI-modell är **en utbytbar rådgivare**. Källmaterial, beräkningar, godkännande och skrivningar ägs alltid av LT Studios kontrollerade serverflöden.

Den befintliga `ai-bookkeeping-pilot` är avsiktligt avstängd och **inte deployad**. Aktivera inte den genom denna plan. Framtida skarpa underlag kräver separat GDPR/DPA-, redovisnings-, säkerhets- och releasebeslut.

## Stabil uppdelning – fem oberoende steg

1. **Underlag**: använd ett befintligt tenantbundet dokument-id från dokumentinkorgen (#728); endast passiv PDF enligt `AGENTS.md`. Autentiserad server hämtar dokumentet och kontrollerar ägarskap, PDF-säkerhet, integritet och aktuellt revisions-/versions-id. Ingen extern URL eller råfil från frontend till modellen.
2. **Fakta**: extrahera observerade värden och källreferenser. Varje faktapunkt har värde, källa, extraktionsmetod och markering `verified` / `unverified`. Återanvänd beprövade deterministiska regler före AI. Saknad eller motsägelsefull information får inte fyllas i som fakta av modellen.
3. **Modellförslag**: serverns provideradapter får minimerade, behörighetskontrollerade fakta; returnerar strikt JSON utan oväntade fält. Cloudflare är första val, men kontraktet ska vara frikopplat från leverantörens egna JSON-format. Fallback: manuellt/regelbaserat, **aldrig tyst betald leverantör**.
4. **Regelgranskning**: oberoende versionerade regler kontrollerar konto, moms (även andra satser än 25 %), belopp i heltalsören, debet/kredit, datum, valuta, företagsform, öppet räkenskapsår, dubblett, dokumentbevis och roll. AI:s egen sannolikhet är inte ett godkännande.
5. **Attest och bokning**: skicka en **granskbar kopia** av ett godkänt förslag till befintliga `automation`- och bokföringsflöden. Behörig användare kan ändra, avvisa eller uttryckligen godkänna. Servern gör en *ny* kontroll mot aktuellt underlag innan vanlig ekonomisk RPC får skriva. Modellen får aldrig skapa verifikationer eller betalningar.

## Versionerat internt förslagskontrakt (målbild, ej databasschema)

Kontraktet är en logisk typ som ska implementeras med en strikt schema-validator; det här är **inte** en instruktion att skapa tabeller eller exponerade API:er nu.

| Fält | Regel |
|---|---|
| `schema_version` | Krävs, t.ex. `1`; okänd version avvisas |
| `proposal_id`, `request_id` | Servergenererat id + klientens idempotensnyckel; unik inom verifierat företag/användare/åtgärd |
| `company_id`, `source_document_id`, `document_version_hash` | Får endast sättas från serververifierat medlemskap och auktoriserat dokument; aldrig betraktas som auktorisation om modellen returnerar dem |
| `source_facts` | Listade verifierade/obekräftade källvärden; referens till källa utan rå PDF i logg |
| `suggested_entries` | Konto, momskod, debet och kredit i heltalsören, begränsad radmängd; inga floats, negativa eller odefinierade konton |
| `rule_checks` | Versionsmärkt deterministiskt resultat inklusive blockerande fel och saknade uppgifter; beräknas **efter** modellsvaret, inte av modellen |
| `provider_trace` | Provideralias, modellversion, promptmall-version, schema-version och neutral begäran-id; **inga tokens, prompts, PII eller dokumenttexter** |
| `review_status` | `needs_review`, `rejected`, `approved`, `superseded`; `posted` är aldrig tillåten status i AI-responsen |
| `review_actor`, `reviewed_at`, `decision_reason` | Enbart serververifierat i attestflödet; revisionshistorik append-only |

Attest- och bokföringsstatus ska inte blandas ihop: `approved` betyder att en person godkänt ett förslag, **inte** att verifikationen skapats, perioden låsts eller bokslutet är klart. Existerande bokföringssystem är sanningskälla för bokningsstatus.

### Livscykel

`created → needs_review → approved/rejected`; nytt underlag, ändrad kontering eller ändrade regelresultat gör tidigare förslag `superseded`. Skapa en ny versionspost vid ny AI-körning; skriv inte över tidigare granskningsspår. Vid providerfel, timeout, budgettak eller oklar källa: `needs_review` med begriplig åtgärd. **Ingen AI-genererad status kan kringgå attest.**

## Särskilda framtidssäkringar

- **För alla företag:** samtliga persistenta objekt och kvoter knyts till verifierat `company_id`; varje läsning och skrivning begränsas med RLS samt serverkontroll. Tester med företag A och B är obligatoriska. Visa aldrig ett annat företags historiska modellkontext.
- **Modelloberoende:** endast provideradaptern känner Cloudflare REST, framtida Gemini/OpenAI eller lokala modeller. En provider kan ersättas via ny version och kvalitetsgrind utan förändring av attest- och bokföringslogik. Ingen automatisk leverantörsfallback eller kostnadsuppgradering.
- **Spårbar kvalitet:** använd en versionsstyrd syntetisk testkorpus med svenska exempel: 0/6/12/25 % moms där tillämpligt, omvänd moms, utland, kreditfaktura, periodskifte, felaktiga summeringar, oklar leverantör, dubblett, skannad/oläslig PDF och dokument med prompt injection. Mät korrekt belopp/konto/momskod, blockerade fel och falskt säkra förslag separat per modellversion. Inför inte automatisk bokning baserat enbart på ett sammanlagt kvalitetsvärde.
- **Budget och kapacitet:** använd den atomära reservations-RPC:n från #774; rate-limit per IP/användare/företag och global budget ska vara fail-closed. Följ token/Neurons som summerad teknisk förbrukning, aldrig fakturainnehåll. När gratisgränsen nås fortsätter grundflödet.
- **Privacy by design:** skicka minsta möjliga text/fält, maskera onödiga personuppgifter, ingen prompt eller PDF i telemetri. Inför dokumenterad retention, åtkomst, radering där rättsligt möjligt och leverantörs-/underbiträdesbedömning innan verklig data behandlas. Bokföringslagens arkivkrav måste respekteras; radering av AI-cache är inte radering av bokföringsunderlag.
- **Oberoende för bokslut:** låt bokslutsassistenten konsumera samma *kontrollerade fakta och regelresultat* men inte lita på ett AI-förslags `approved` som bevis på avstämt konto eller färdigställd årsredovisning.
- **Användarupplevelse:** visa `Föreslagen av AI`, källa, vad systemet har kontrollerat, vad som är osäkert och knapparna `Godkänn`, `Ändra`, `Behöver hjälp`. Göm BAS-konton bakom `Visa detaljer`; bokföring ska fungera även utan AI.

## Nästa avgränsade PR:er och hårda grindar

1. **#774 säker syntetisk pilot:** verifiera betrodd klient-IP i *hostad* Supabase-miljö, giltig session, AAL2, RLS, quota/idempotens under samtidighet, två företag, avslag och felvägar. Behåll `RELEASE_APPROVED=false` och `DURABLE_IP_LIMITER_VERIFIED=false` tills evidens och separat godkännande finns. Lägg inte till publik route av misstag.
2. **Kontrakt och testkorpus:** definiera strikt JSON-schema och adaptertester under befintliga `packages/automation` utan att ändra dokumentinkorgen, bokslutet eller ekonomiska RPC:er som andra agenter äger. Negative cases måste stoppa olämpliga förslag.
3. **Förslagskö:** anslut granskade resultat till befintlig automationskö med append-only beslut, versionsbindning och serverrevalidering; ingen egen AI-bokföringsdatabas som parallell sanning.
4. **Privat syntetisk UAT:** kör roller/tenant/rate-limit/regressioner och Quality, CodeQL, Supabase clean rebuild samt visuell portaltest. Först därefter separat beslut om pilotdeployment.
5. **Verklig data:** endast efter dataskydds-, leverantörs-, säkerhets- och redovisningsgodkännande. Produktion kräver dessutom granskade backup-, övervaknings- och revisionsrutiner enligt `docs/CURRENT-ARCHITECTURE.md`.

## Klart kontra kvarstår 2026-10-13

**Förberett i GitHub:** leverantörsbeslut, syntetisk modell-/schemaadapter, portalens testvy, spärrad Edge-gateway och atomärt kvotkontrakt. **Inte bekräftat i drift:** AI-funktion i Supabase, Cloudflare-anrop, säkert verifierad proxy-IP, godkänd dataskyddsprocess eller AI-förslag på skarpa kundunderlag. Separera dessa statusar i all kundkommunikation.
