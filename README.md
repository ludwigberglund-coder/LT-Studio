# Rolands / LT Studio – småföretagsplattform

Vi bygger en återanvändbar plattform för småföretag. Referenskunders verkliga identitet, innehåll och driftinställningar hålls utanför det publika repositoryt och separeras från gemensamma verksamhetsregler.

**Aktuell fas: Production Readiness Phase 1. Inga nya stora moduler prioriteras. Plattformen är ännu inte godkänd för pilot med verkliga ekonomiska data.**

Börja här:

- Säkerhetspolicy och privat rapportering
- Audit: konkreta risker, källor och rättelser
- ROLANDS PILOT READINESS CHECKLIST
- Backup och verifierad återställning
- Synthetic-only staging deployment
- Pilotens deployment-instruktion
- Produktvision
- SaaS-målarkitektur för flera kunder
- Flerföretagsaudit och luckor för kund nummer två
- PostgreSQL-migreringsplan

## Öppna LT Studio UAT

[**Klicka här för att aktivera UAT-konto / slutföra MFA och öppna LT Studio**](https://ludwigberglund-coder.github.io/LT-Studio/portal/uat-setup.html)

Detta är den enda UAT-länken som ska användas från README.

## GitHub är vår gemensamma källa

GitHub innehåller kod, tester, offentlig konfiguration, dokumentation och ändringshistorik. Produktionsdatabasen och skyddad dokumentlagring är källan för verksamhetsdata. Kunduppgifter, löner, bankuppgifter, originalfakturor, databasfiler och riktiga hemligheter får inte läggas i det publika repot eller GitHub Pages.

Alla ändringar görs i en arbetsgren. Granska skillnaden, kör relevanta tester och full CI, skapa tydlig commit/PR och slå ihop först när kontrollerna passerat. Kontrollera sedan huvudgrenens kontroller för rätt commit. En lyckad demo-publicering är inte i sig ett produktionsgodkännande.

## Så är det uppbyggt idag

```text
apps/website/            publik hemsida
apps/portal/             företagsportal med API- och separat demoläge
apps/api/                Node.js-backend, sessioner, företagsmedlemskap och SQLite
apps/admin/              äldre projektadmin och domändemos
packages/                delade ekonomi-, behörighets- och faktureringsregler
content/                 offentliga texter och företagsuppgifter
config/                  offentliga mallar och regler, aldrig secrets
scripts/                 bygge, kontroll, bootstrap och driftverktyg
test/                    kod-, API- och webbläsartester
docs/                    beslut, guider och granskningsbevis
public/ och server.js    äldre referensimplementation, inte pilotbackend
```

Den aktuella backenddatabasen är SQLite med främmande nycklar, WAL och FULL-synkronisering. Den är inte PostgreSQL. Personlig inloggning, MFA, medlemskapskontroller och företagsfiltrering finns. Journalpostning är atomisk och deklarerade företagsrelationer kontrolleras på databasnivå. Fullständig oföränderlighet, momsavstämning, driftisolering och flera andra pilotspärrar återstår enligt checklistan.

Den persistenta bokföringen i `apps/api/accounting-store.js` och domändemon i `packages/accounting/journal.js` är olika implementationer. Kontrollera vilken som faktiskt används när en funktion granskas.

## Utveckling och test

Krav: Node.js 24 och npm. Använd endast testuppgifter i utveckling.

```sh
npm ci
npm run content:check
npm test
npm run build:static
npm run preview:static
```

Den statiska förhandsvisningen är avsedd för demo. Befintliga webbläsartester körs även i GitHub Actions. De täcker inte automatiskt alla företagsgränser, alla knappar eller den riktiga HTTPS-/API-miljön.

Backend startas med:

```sh
npm start
```

`npm start` och `npm run api` startar `apps/api/server.js`. `npm run dev` och `npm run legacy:start` startar den äldre referensservern och ska inte användas för pilotdrift. `npm run data:backup` gäller det äldre JSON-lagret; använd `pilot:backup` för SQLite.

För lokal utveckling kan en separat testdatabas användas. Riktig staging får däremot endast skapas via `npm run staging:bootstrap:synthetic -- --apply`; inga Rolands- eller andra kunddata får användas där. Se `.env.example` och deployment-guiden. Lägg inte riktiga värden i GitHub. Privata bankgiro-/fakturainställningar läggs i databasen via `npm run platform:set-invoice-settings`, inte i offentliga innehållsfiler.

## Driftkontroller – inte ett automatiskt pilotgodkännande

```sh
npm run pilot:preflight
npm run pilot:check
npm run pilot:backup
npm run pilot:restore:verify
```

Miljövariabler och säkra sökvägar beskrivs i `.env.example` och backup-guiden. Pilot-/produktionsstart kör också en bindande miljökontroll. Den ersätter inte verifiering av faktisk hosting och backup. Återställningskommandot skapar bara en separat testkopia och ersätter aldrig produktionsdatabasen.

Vid `TENANT_INTEGRITY_ERROR` ska uppstarten stoppas och historiken bevaras för utredning. Radera inte poster eller stäng av kontrollerna för att få servern att starta.

## Offentlig webbplats och portaldemo

Webbplatsen och portaldemon publiceras av GitHub Pages. Demon är endast en förhandsvisning av gränssnittet; uppgifter som ni matar in delas inte mellan era webbläsare.

Offentliga texter finns i `content/site.json` och `content/company.json`. Se redigeringsguiden. Företagets juridiska/ekonomiska inställningar ska inte ändras via ett offentligt CMS.

## Fördjupning

Behörigheter, penningmodell, verifikationsdomän, produktvision, målarkitektur och arbetsregel vid väntande beslut.

Äldre systemöversikter beskriver tidigare etapper. Vid motstridiga statusuppgifter gäller den senaste källkoden och daterade audit-/testbevis. En planerad funktion ska inte beskrivas som driftsatt eller verifierad innan bevis finns.
