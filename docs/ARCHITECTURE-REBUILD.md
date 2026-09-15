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

## Föreslagen ny struktur

När ombyggnaden startar flyttas funktionaliteten stegvis till följande gränser:

```text
apps/
  website/        Publik webbplats
  admin/          Ekonomi- och administrationsgränssnitt
  api/            Backend/API
packages/
  accounting/     Bokföringsregler och verifikationsmotor
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
- Kalenderår används som räkenskapsår.
- K2 är målregelverk men verifieras mot senaste signerade årsredovisning före skarp drift.
- Månatlig moms är målkonfiguration men den registrerade momsperioden verifieras mot Skatteverket före skarp drift.
- Lager är en förstaklassmodul i systemet.
- Lön bokförs och stäms av i Rollands, med stöd för import från extern löneleverantör.
- Bokföringsposter ska vara spårbara och rättas med mot-/rättelseverifikationer i stället för att skrivas över.
- Roller, attest och personliga användarkonton byggs in innan produktionssättning.

## Rekommenderad byggordning

1. Gemensam projektstruktur, typer och testinfrastruktur.
2. Datamodell med öresprecision och PostgreSQL-migreringar.
3. Identitet, roller och attest.
4. Bokföringsmotor och periodhantering.
5. Kund- och leverantörsreskontra.
6. Bankavstämning.
7. Lager och svinn.
8. Löneimport och lönejournal.
9. Rapporter, moms och SIE.
10. Originalunderlag, backup, driftövervakning och produktionshärdning.

## Publiceringsprincip

Varje push som når `main` ska först ha passerat tester. GitHub Pages-demon byggs därefter automatiskt från samma kod. När produktionsmiljön införs ska även den deployas från `main` eller signerade releaser, aldrig från lokala filer.
