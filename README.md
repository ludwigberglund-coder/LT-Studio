# Rolands / LT Studio – småföretagsplattform

Vi bygger en återanvändbar plattform för småföretag. Referenskunders verkliga identitet, innehåll och driftinställningar hålls utanför det publika repositoryt och separeras från gemensamma verksamhetsregler.

**Aktuell fas: Production Readiness Phase 1. Inga nya stora moduler prioriteras. Plattformen är ännu inte godkänd för pilot med verkliga ekonomiska data.**

Börja här:

- [Säkerhetspolicy och privat rapportering](SECURITY.md)
- [Audit: konkreta risker, källor och rättelser](docs/PRODUCTION-READINESS-AUDIT-2026-09-18.md)
- [ROLANDS PILOT READINESS CHECKLIST](docs/ROLANDS-PILOT-READINESS-CHECKLIST.md)
- [Backup och verifierad återställning](docs/BACKUP-RESTORE-PILOT.md)
- [Synthetic-only staging deployment](docs/STAGING-DEPLOYMENT.md)
- [Pilotens deployment-instruktion](docs/ROLANDS-PILOT-DEPLOYMENT.md)
- [Produktvision](docs/PRODUCT-VISION.md)
- [SaaS-målarkitektur för flera kunder](docs/SAAS-TARGET-ARCHITECTURE.md)
- [Flerföretagsaudit och luckor för kund nummer två](docs/MULTI-TENANT-GAP-AUDIT-2026-09-20.md)
- [PostgreSQL-migreringsplan](docs/POSTGRESQL-MIGRATION-PLAN.md)

## Öppna gränssnittet via GitHub

[**Öppna gemensam UAT**](https://ludwigberglund-coder.github.io/LT-Studio/uat/) · [**Öppna webbplatsen**](https://ludwigberglund-coder.github.io/LT-Studio/) · [**Öppna portaldemon direkt**](https://ludwigberglund-coder.github.io/LT-Studio/portal/dashboard.html?demo=1) · [**Se publiceringsstatus**](https://github.com/ludwigberglund-coder/LT-Studio/actions/workflows/pages.yml)

GitHub Actions bygger och publicerar automatiskt den gemensamma UAT-versionen från varje uppdatering av `main` till **samma länk**. UAT-gränssnittet körs på GitHub Pages och använder den gemensamma Supabase-UAT-miljön för inloggning och delad testdata. Ni behöver alltså inte byta länk mellan ändringar. En ny version syns när publiceringen har lyckats; vid ett misslyckat bygge ligger den tidigare publicerade versionen kvar. Kontrollera statuslänken om ni vill verifiera publiceringen.

**Viktigt:** Den gemensamma UAT:n är endast för syntetiska testuppgifter och är inte godkänd för verkliga ekonomiska data. Länken `portal/dashboard.html?demo=1` är däremot fortsatt en separat lokal demo där data inte delas mellan webbläsare.

## GitHub är vår gemensamma källa

GitHub innehåller kod, tester, offentlig konfiguration, dokumentation och ändringshistorik. Produktionsdatabasen och skyddad dokumentlagring är källan för verksamhetsdata. Kunduppgifter, löner, bankuppgifter, originalfakturor, databasfiler och riktiga hemligheter får inte läggas i det publika repot eller GitHub Pages.

Alla ändringar görs i en arbetsgren. Granska skillnaden, kör relevanta tester och full CI, skapa tydlig commit/PR och slå ihop först när kontrollerna passerat. Kontrollera sedan huvudgrenens kontroller för rätt commit. En lyckad demo-publicering är inte i sig ett produktionsgodkännande.

## Så är det uppbyggt idag

```text
apps/website/            publik hemsida
apps/portal/             företagsportal med Supabase-UAT och separat demoläge
apps/api/                äldre/kompletterande Node.js-backend för SQLite-baserade driftflöden
apps/admin/              äldre projektadmin och domändemos
packages/                delade ekonomi-, behörighets- och faktureringsregler
content/                 offentliga texter och företagsuppgifter
config/                  offentliga mallar och regler, aldrig secrets
scripts/                 bygge, kontroll, bootstrap och driftverktyg
test/                    kod-, API- och webbläsartester
docs/                    beslut, guider och granskningsbevis
public/ och server.js    äldre referensimplementation, inte pilotbackend
```

Den gemensamma UAT-miljön använder Supabase/PostgreSQL med Supabase Auth, MFA/AAL2, företagsmedlemskap och Row Level Security. Den äldre Node.js/SQLite-backenden finns fortfarande kvar för separata drift- och kompatibilitetsflöden och ska inte förväxlas med den delade GitHub Pages-UAT:n. Plattformen är fortfarande inte godkänd för verkliga ekonomiska data.

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

Miljövariabler och säkra sökvägar beskrivs i `.env.example` och [backup-guiden](docs/BACKUP-RESTORE-PILOT.md). Pilot-/produktionsstart kör också en bindande miljökontroll. Den ersätter inte verifiering av faktisk hosting och backup. Återställningskommandot skapar bara en separat testkopia och ersätter aldrig produktionsdatabasen.

Vid `TENANT_INTEGRITY_ERROR` ska uppstarten stoppas och historiken bevaras för utredning. Radera inte poster eller stäng av kontrollerna för att få servern att starta.

## Offentlig webbplats och portaldemo

[Webbplatsen](https://ludwigberglund-coder.github.io/LT-Studio/) och [portaldemon](https://ludwigberglund-coder.github.io/LT-Studio/portal/dashboard.html?demo=1) publiceras av GitHub Pages. Demon är endast en förhandsvisning av gränssnittet; uppgifter som ni matar in delas inte mellan era webbläsare.

Offentliga texter finns i `content/site.json` och `content/company.json`. Se [redigeringsguiden](docs/EDITING.md). Företagets juridiska/ekonomiska inställningar ska inte ändras via ett offentligt CMS.

## Fördjupning

[Behörigheter](docs/ACCESS-CONTROL.md), [penningmodell](docs/MONEY-DOMAIN.md), [verifikationsdomän](docs/JOURNAL-DOMAIN.md), [produktvision](docs/PRODUCT-VISION.md), [målarkitektur](docs/ARCHITECTURE-REBUILD.md) och [arbetsregel vid väntande beslut](docs/WORKFLOW.md).

Äldre systemöversikter beskriver tidigare etapper. Vid motstridiga statusuppgifter gäller den senaste källkoden och daterade audit-/testbevis. En planerad funktion ska inte beskrivas som driftsatt eller verifierad innan bevis finns.
