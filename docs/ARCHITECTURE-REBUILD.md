# Rollands – målarkitektur för ombyggnad från grunden

## Grundprincip

GitHub är projektets enda källa för kod, dokumentation, tester och releasehistorik. Varje ändring ska gå via GitHub och automatiska kontroller innan den når `main`.

GitHub ska däremot inte lagra skarp bokföringsdata, kunddata, bankdata, lösenord eller hemligheter.

## Miljöer

### 1. Demo – GitHub Pages

- Byggs automatiskt från `main`.
- Publiceras av `.github/workflows/pages.yml`.
- Innehåller endast frontend och tydligt märkt demodata.
- Ändringar i demo sparas endast lokalt i webbläsaren.
- Får aldrig användas som skarp ekonomidrift.

### 2. Utveckling

- Samma GitHub-repository.
- Lokalt eller i en separat utvecklingsmiljö med testdatabas.
- Pull requests och GitHub Actions används för kvalitetssäkring.

### 3. Produktion – senare steg

- Deployas från samma GitHub-repository.
- Frontend och backend körs i en riktig driftmiljö.
- PostgreSQL eller motsvarande transaktionsdatabas används för skarp ekonomidata.
- Bilagor och originalunderlag lagras i skyddad objektlagring.
- Hemligheter hanteras av driftplattformens secret manager och aldrig i GitHub-källkod.
- Personliga konton, MFA och servervaliderade sessioner används för all administrativ åtkomst.

## Föreslagen ny struktur

Funktionaliteten flyttas stegvis till tydliga gränser:

```text
apps/
  website/        Publik webbplats
  admin/          Ekonomi- och administrationsgränssnitt
  api/            Backend/API
packages/
  accounting/     Penning-, bokförings- och verifikationsregler
  access-control/ Roller, behörigheter och attestseparation
  invoicing/      Kund- och leverantörsfakturor
  inventory/      Lager, inventering och svinn
  payroll/        Lönejournal och löneimport
  reporting/      Rapporter, momsunderlag och SIE
  shared/         Gemensamma typer, validering och verktyg
docs/
config/
```

Det gamla systemet ska inte rivas på en gång. Det används som fungerande referens medan nya moduler ersätter det stegvis och testas mot samma affärsregler.

## Tekniska beslut

- Penningbelopp lagras som heltal i ören.
- Kvantiteter som behöver decimaler lagras som skalade heltal, inte flyttal.
- All åtkomst använder default deny och namngivna behörigheter.
- Systemadministration och ekonomiska beslut är separata roller.
- Kritiska arbetsflöden använder fyrögonprincip även när någon har flera roller.
- Kalenderår används som räkenskapsår.
- K2 är målregelverk men verifieras mot senaste signerade årsredovisning före skarp drift.
- Månatlig moms är målkonfiguration men den registrerade momsperioden verifieras mot Skatteverket före skarp drift.
- Lager är en förstaklassmodul i systemet.
- Lön bokförs och stäms av i Rollands, med stöd för import från extern löneleverantör.
- Bokföringsposter ska vara spårbara och rättas med mot-/rättelseverifikationer i stället för att skrivas över.
- Frontend får aldrig vara ensam säkerhetskontroll; framtida API kontrollerar varje skyddad åtgärd på serversidan.

## Genomförda grundlager

1. **Projektstruktur och innehåll:** publik webbplats, projektadmin, redigerbara innehållsfiler och automatisk GitHub Pages-publicering.
2. **Penningdomän:** öresprecision, skalade kvantiteter, momsberäkning och testbar fakturakalkylator.
3. **Behörighetsdomän:** default deny, rollmatris, MFA-krav och separationsregler för kritiska arbetsflöden.

Dessa lager är fristående och ska återanvändas av kommande API och verksamhetsmoduler.

## Rekommenderad fortsatt byggordning

1. Ny verifikations- och periodmotor ovanpå öres- och behörighetsdomänerna.
2. Kund- och leverantörsreskontra.
3. Bankavstämning.
4. Lager och svinn.
5. Löneimport och lönejournal.
6. Rapporter, moms och SIE.
7. Riktig identitetsleverantör, sessionshantering och MFA i produktions-API:t.
8. Originalunderlag, backup, driftövervakning och produktionshärdning.

Behörighetsreglerna byggs före den riktiga inloggningen för att verksamhetsmodulerna ska kunna använda stabila rättigheter från början. När identitetsleverantören kopplas in behöver den endast leverera verifierad användaridentitet och roller till samma regelmotor.

## Publiceringsprincip

Varje push som når `main` ska först ha passerat tester. GitHub Pages-demon byggs därefter automatiskt från samma kod. När produktionsmiljön införs ska även den deployas från `main` eller signerade releaser, aldrig från lokala filer.
