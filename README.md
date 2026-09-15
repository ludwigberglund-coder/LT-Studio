# Rollands – komplett småföretagsplattform med Rolands som första referenskund

GitHub är projektets enda källa för kod, redigerbart innehåll, dokumentation, tester och releasehistorik. Den publika demon byggs automatiskt från `main` och publiceras med GitHub Pages.

## Produktens syfte

Vi bygger inte endast en enskild hemsida eller ett isolerat ekonomiprogram för Rolands. Målet är en återanvändbar plattform för saluhallar, småbutiker, mindre restauranger, caféer och närliggande småföretag.

Rolands Frukt o Grönt Aktiebolag är kund nummer ett och vår första kompletta referensimplementation. Den färdiga kedjan ska vara:

`publik hemsida → säker login → privat företagsportal → ekonomi, lager, dokument, webbplats och övriga moduler`

Rolands-specifika texter, färger, inställningar och data ska ligga i företagets konfiguration och egen datamiljö. Gemensamma regler för exempelvis pengar, behörigheter, bokföring och säkerhet ska kunna återanvändas av nästa företag utan en ny kodbas.

Läs först:

- [Produktvision och principer](docs/PRODUCT-VISION.md)
- [Enkel förklaring av hela nuläget, upplägget och planen](docs/SYSTEM-OVERVIEW.md)
- [Kort projektbrief](docs/PROJECT-BRIEF.md)
- [Målarkitektur](docs/ARCHITECTURE-REBUILD.md)

## Aktuella demos

- **Publik hemsida:** <https://ludwigberglund-coder.github.io/Rollands/>
- **Projektadmin:** <https://ludwigberglund-coder.github.io/Rollands/admin/>
- **Öreskalkylator:** <https://ludwigberglund-coder.github.io/Rollands/admin/#/money>
- **Roller och behörigheter:** <https://ludwigberglund-coder.github.io/Rollands/admin/#/access>
- **Verifikationer och perioder:** <https://ludwigberglund-coder.github.io/Rollands/admin/#/journal>
- **Tidigare systemdemo:** <https://ludwigberglund-coder.github.io/Rollands/legacy/#/overview>

> GitHub Pages är en demo- och granskningsmiljö. Skarp bokföringsdata, kunddata, bankdata, fakturor, personuppgifter och hemligheter får aldrig lagras där eller i det publika repot.

## Enklare ändringar

Vanliga ändringar görs i tydliga innehålls- och konfigurationsfiler i stället för inne i programkoden:

| Ändring | Fil |
|---|---|
| Företagsnamn, adress, telefon och e-post | `content/company.json` |
| Webbplatsens rubriker, texter och erbjudanden | `content/site.json` |
| Adminmeny, moduler och utvecklingsplan | `content/admin.json` |
| Räkenskapsår, K2, moms, lön och lager | `config/rolands-business-decisions.json` |
| Roller, behörigheter, MFA-krav och attestseparation | `config/access-control.json` |

Se [den enkla redigeringsguiden](docs/EDITING.md). Projektadmin innehåller dessutom ett formulär för vanliga webbplatstexter, lokal förhandsvisning och export av en färdig `site.json`.

## Exakt penningmodell

Alla nya ekonomifunktioner använder `packages/accounting/money.js` som gemensam kärna:

- belopp lagras som heltal i ören,
- kvantiteter stöder upp till tre decimaler,
- moms beräknas per rad och grupperas per momssats,
- svenska decimaler med komma eller punkt accepteras,
- osäker precision och för stora värden stoppas i stället för att gissas.

Projektadmin har en interaktiv öreskalkylator som använder samma modul som fakturering, lager och bokföring ska bygga på. Se [penningmodellens dokumentation](docs/MONEY-DOMAIN.md).

## Roller och behörighetsgränser

Alla nya skyddade funktioner använder `packages/access-control/authorization.js`. Regelverket bygger på:

- default deny – allt nekas tills en uttrycklig behörighet finns,
- personliga konton i produktion,
- minsta möjliga åtkomst per roll,
- MFA för känsliga roller,
- separata roller för systemadministration och ekonomiska beslut,
- fyrögonprincip för leverantörsattest, betalningar, periodupplåsning och lagerjustering.

Projektadmin visar en rollmatris och kan simulera både vanliga behörighetsbeslut och separationsregler. Det är en regel- och granskningsdemo, inte en verklig inloggning. Se [behörighetsdokumentationen](docs/ACCESS-CONTROL.md).

## Verifikations- och periodmotor

`packages/accounting/journal.js` är den nya bokföringskärnan. Den:

- kräver balanserade verifikationer i ören,
- ger obrutna löpnummer per serie och år,
- stoppar ogiltiga konton, datum och behörigheter,
- blockerar bokföring i låsta perioder,
- kräver separat beställare vid periodupplåsning,
- rättar bokförda poster med motverifikation och valfri ersättningspost,
- bevarar originalposten och behandlingshistoriken,
- kontrollerar dubbletter, totalsummor, nummerserier och rättelsekopplingar.

Projektadmin innehåller en interaktiv demo där roller, bokföring, periodlås och motverifikationer kan provas lokalt i webbläsaren. Se [verifikationsdomänens dokumentation](docs/JOURNAL-DOMAIN.md).

## Projektstruktur

```text
apps/
  website/               publik webbplats
  admin/                 projektadmin och domändemos

packages/
  accounting/            penning-, verifikations- och periodregler
  access-control/        roller, behörigheter och attestseparation
  shared/browser/        delade små webbläsarverktyg

content/                  redigerbara texter och företagsuppgifter
config/                   verksamhetsbeslut och behörighetskonfiguration
public/                   tidigare system som migreringsreferens
docs/                     produktvision, förklaringar, beslut och planer
scripts/                  validering, bygge och lokal förhandsvisning
test/                     automatiska tester
```

Den tidigare versionen ligger kvar under `/legacy/` medan nya delar byggs från grunden. Varje ny modul kan därför jämföras med befintliga affärsflöden innan den gamla tas bort.

## Automatisk publicering

När en ändring slås ihop till `main` sker följande:

1. Innehålls-, verksamhets- och behörighetsfiler valideras.
2. JavaScript syntaxkontrolleras.
3. Bokförings-, säkerhets-, penning-, behörighets-, verifikations- och grundtester körs.
4. Produktionsberoenden granskas.
5. En statisk demo byggs.
6. GitHub Pages publiceras automatiskt.

En felaktig innehållsfil, okänd behörighet, obalanserad verifikation, bruten separationsregel eller ett testfel stoppar publiceringen.

## Starta lokalt

Krav: Node.js 24 LTS eller senare.

```powershell
npm ci
npm run preview:static
```

Öppna sedan `http://127.0.0.1:4174`.

Den äldre lokala API-servern kan fortfarande startas med:

```powershell
npm start
```

## Viktiga kommandon

```powershell
npm run content:check
npm test
npm run build:static
npm run preview:static
npm run data:check
npm run data:backup
npm run export:sie4i
```

## Långsiktig riktning

Öreskärnan, behörighetsmotorn och verifikations-/periodmotorn är separata, testade byggblock. Nästa stora plattformssteg är:

1. företagsneutral modell och en andra testkund,
2. riktig backend, PostgreSQL, personlig login, MFA och företagsisolering,
3. ny kund- och leverantörsreskontra,
4. bankavstämning,
5. lager och svinn,
6. rapportering, moms, SIE, lön, dokument och webbplats-CMS,
7. säkerhets-, drift- och redovisningsgranskning inför skarp Rolands-miljö.

GitHub ska fortsätta vara sanningskälla för programmet och dokumentationen. Produktionsdatabasen och den skyddade dokumentlagringen ska vara sanningskälla för varje företags privata affärsdata.
