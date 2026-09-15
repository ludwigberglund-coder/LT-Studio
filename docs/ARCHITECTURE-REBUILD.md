# Rollands – målarkitektur för ombyggnad från grunden

## Grundprincip

GitHub är projektets enda källa för kod, dokumentation, tester och releasehistorik. Varje ändring ska gå via GitHub och automatiska kontroller innan den når `main`.

GitHub ska däremot inte lagra skarp bokföringsdata, kunddata, bankdata, lösenord eller hemligheter.

Den överordnade produktvisionen finns i [PRODUCT-VISION.md](PRODUCT-VISION.md). Rolands är den första kompletta referenskunden, medan plattformens kärna ska kunna användas av andra saluhallar, småbutiker och mindre restauranger.

## Systemgränser

Den färdiga lösningen består av fyra tydliga gränser:

1. **Publik webbplats** – innehåller endast information och funktioner som ska vara öppna för besökare.
2. **Login och identitet** – verifierar användaren och skapar en säker servervaliderad session.
3. **Privat företagsportal** – visar endast det företag och de moduler som användaren har åtkomst till.
4. **Backend, databas och dokumentlagring** – kontrollerar varje skyddad åtgärd och håller företagens data strikt åtskild.

En dold `/admin`-adress är aldrig en säkerhetsgräns. Frontendnavigation får förbättra användarupplevelsen men backend är alltid den slutliga kontrollen.

## Företagsmodell och isolering

Alla privata verksamhetsobjekt ska i produktion vara kopplade till ett internt, oföränderligt `companyId`, exempelvis:

- användarmedlemskap,
- kunder och leverantörer,
- fakturor och betalningar,
- verifikationer och perioder,
- banktransaktioner,
- artiklar och lagerhändelser,
- löneunderlag,
- dokument och integrationer.

Företagsisolering ska finnas i flera lager:

1. sessionen anger vilket eller vilka företag användaren får öppna,
2. behörighetsmotorn kontrollerar rollen inom valt företag,
3. varje API-operation kräver ett verifierat företagssammanhang,
4. varje databasfråga avgränsas till rätt `companyId`,
5. dokumentlagringen använder separata företagssökvägar och serverkontroller,
6. tester försöker läsa och ändra data mellan två olika företag och ska nekas.

Organisationsnummer och företagsnamn används för verksamhetsinformation, men får inte fungera som tekniska primärnycklar.

## Företagsanpassning

Gemensam plattformskod ska hållas åtskild från företagets egen konfiguration.

Varje företag ska kunna ha egna:

- företagsuppgifter,
- tema, logotyp och domän,
- webbtexter och bilder,
- öppettider och erbjudanden,
- aktiverade moduler,
- bokförings- och momsinställningar,
- kontoplan och nummerserier,
- användare, roller och attestregler,
- integrationer,
- affärsdata och dokument.

Nästa kund ska skapas som en ny företagsmiljö, inte som en kopia av hela kodbasen.

## Miljöer

### 1. Demo – GitHub Pages

- Byggs automatiskt från `main`.
- Publiceras av `.github/workflows/pages.yml`.
- Innehåller endast frontend och tydligt märkt demodata.
- Ändringar i demo sparas endast lokalt i webbläsaren.
- Får aldrig användas som skarp ekonomidrift.
- Har inte verklig login eller privat datalagring.

### 2. Utveckling

- Samma GitHub-repository.
- Separat utvecklings-API och testdatabas.
- Testföretag, aldrig verklig produktionsdata.
- Pull requests och GitHub Actions används för kvalitetssäkring.

### 3. Test eller staging

- Produktionslik backend och databas.
- Används för integrations-, migrations-, säkerhets- och återställningstester.
- Har separata hemligheter och data från både utveckling och produktion.

### 4. Produktion

- Deployas från samma GitHub-repository eller signerade releaser.
- Frontend och backend körs i en riktig driftmiljö.
- PostgreSQL eller motsvarande transaktionsdatabas används för skarp ekonomidata.
- Bilagor och originalunderlag lagras i skyddad objektlagring.
- Hemligheter hanteras av driftplattformens secret manager och aldrig i GitHub-källkod.
- Personliga konton, MFA och servervaliderade sessioner används för all administrativ åtkomst.
- Backup, återställning, övervakning och incidentrutiner är aktiva.

## Föreslagen projektstruktur

Funktionaliteten flyttas stegvis till tydliga gränser:

```text
apps/
  website/        Publik webbplats och framtida företagsteman
  login/          Inloggningssida och identitetsflöden
  admin/          Ekonomi- och administrationsgränssnitt
  api/            Backend/API

packages/
  companies/      Företagsmodell, medlemskap och modulaktivering
  accounting/     Penning-, bokförings- och verifikationsregler
  access-control/ Roller, behörigheter och attestseparation
  invoicing/      Kund- och leverantörsfakturor
  banking/        Import, matchning och bankavstämning
  inventory/      Lager, inventering och svinn
  payroll/        Lönejournal och löneimport
  documents/      Dokumentmetadata och åtkomstregler
  reporting/      Rapporter, momsunderlag och SIE
  shared/         Gemensamma typer, validering och verktyg

infrastructure/
  database/       Migreringar, databasregler och testdata
  deployment/     Drift- och miljökonfiguration utan hemligheter

docs/
config/
```

Den exakta mappstrukturen införs stegvis när respektive modul byggs. Vi skapar inte tomma lager bara för att fylla en ritning.

Det gamla systemet ska inte rivas på en gång. Det används som fungerande referens medan nya moduler ersätter det stegvis och testas mot samma affärsregler.

## Tekniska beslut

- Penningbelopp lagras som heltal i ören.
- Kvantiteter som behöver decimaler lagras som skalade heltal, inte flyttal.
- All åtkomst använder default deny och namngivna behörigheter.
- Roller tilldelas inom ett specifikt företag, inte globalt utan sammanhang.
- Systemadministration och ekonomiska beslut är separata roller.
- Kritiska arbetsflöden använder fyrögonprincip även när någon har flera roller.
- Verifikationer måste balansera exakt i ören och får obrutna nummer per serie och år.
- Bokförda poster är append-only: rättelser skapar mot- och ersättningsverifikationer i stället för överskrivning.
- Periodlås är en egen domänregel och upplåsning kräver både behörighet, orsak och separat beställare.
- Kalenderår används som räkenskapsår för Rolands första konfiguration.
- K2 är målregelverk för Rolands men verifieras mot senaste signerade årsredovisning före skarp drift.
- Månatlig moms är målkonfiguration för Rolands men registrerad momsperiod verifieras mot Skatteverket före skarp drift.
- Lager är en förstaklassmodul i systemet.
- Lön bokförs och stäms av i plattformen, med stöd för import från extern löneleverantör.
- Frontend får aldrig vara ensam säkerhetskontroll; API kontrollerar varje skyddad åtgärd på serversidan.
- Skarp affärsdata ska aldrig paketeras i frontendbygget eller lagras i GitHub.

## Genomförda grundlager

1. **Projektstruktur och innehåll:** publik webbplats, projektadmin, redigerbara innehållsfiler och automatisk GitHub Pages-publicering.
2. **Penningdomän:** öresprecision, skalade kvantiteter, momsberäkning och testbar fakturakalkylator.
3. **Behörighetsdomän:** default deny, rollmatris, MFA-krav och separationsregler för kritiska arbetsflöden.
4. **Verifikations- och perioddomän:** balanserade poster, löpnummer, periodlås, upplåsningsseparation, motverifikationer och integritetskontroll.
5. **Migreringsreferens:** tidigare systemdelar ligger kvar under `/legacy/` för jämförelse av funktioner och arbetsflöden.

Dessa lager är fristående och ska återanvändas av kommande API och verksamhetsmoduler.

## Rekommenderad fortsatt byggordning

1. Gemensam företagsmodell, medlemskap, modulaktivering och andra testkunden.
2. Produktionsinriktad API-grund, PostgreSQL, migreringar och företagsisolering.
3. Personlig autentisering, sessioner, MFA, inbjudan och kontohantering.
4. Kund- och leverantörsreskontra ovanpå penning-, behörighets- och verifikationsdomänerna.
5. Säker dokumentlagring och koppling mellan underlag och affärspost.
6. Bankavstämning med idempotent import och tydlig koppling till reskontra.
7. Lager och svinn.
8. Löneimport och lönejournal.
9. Rapporter, moms och SIE från de nya modellerna.
10. Webbplats-CMS, uppgifter, aviseringar och branschmoduler.
11. Säkerhets-, drift- och redovisningsgranskning före skarp Rolands-miljö.

Behörighetsreglerna byggs före den riktiga inloggningen för att verksamhetsmodulerna ska kunna använda stabila rättigheter från början. När identitetsleverantören kopplas in ska den leverera verifierad användaridentitet och företagsmedlemskap till samma regelmotor.

Verifikationsdomänen är ännu lagringsoberoende. När PostgreSQL införs ska varje domänoperation köras i en databastransaktion med idempotensnyckel och lämplig låsning, utan att försvaga domänens affärsregler.

## Arkitekturtest med två företag

Innan vi betraktar plattformen som företagsneutral ska en automatisk eller reproducerbar testmiljö innehålla minst två företag, exempelvis:

- Rolands som referenskund,
- en påhittad mindre restaurang eller butik.

Testet ska visa att:

- företagen kan ha olika design och aktiverade moduler,
- användare får olika roller i respektive företag,
- samma e-postadress vid behov kan vara medlem i mer än ett företag utan sammanblandning,
- fakturor, bokföring, lager och dokument aldrig läcker mellan företagen,
- den gemensamma ekonomiska kärnan används av båda.

## Publiceringsprincip

Varje ändring ska gå via en gren eller pull request och automatiska kontroller innan den når `main`. GitHub Pages-demon byggs därefter automatiskt från samma kod.

När produktionsmiljön införs ska även den deployas från `main` eller signerade releaser, aldrig från okontrollerade lokala filer.
