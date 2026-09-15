# Rollands – långsiktig webb- och ekonomiplattform

GitHub är projektets enda källa för kod, redigerbart innehåll, dokumentation, tester och releasehistorik. Den publika demon byggs automatiskt från `main` och publiceras med GitHub Pages.

- **Demo:** <https://ludwigberglund-coder.github.io/Rollands/>
- **Projektadmin:** <https://ludwigberglund-coder.github.io/Rollands/admin/>
- **Öreskalkylator:** <https://ludwigberglund-coder.github.io/Rollands/admin/#/money>
- **Tidigare systemdemo:** <https://ludwigberglund-coder.github.io/Rollands/legacy/#/overview>

> GitHub Pages är en demo- och granskningsmiljö. Skarp bokföringsdata, kunddata, bankdata, fakturor och hemligheter får aldrig lagras där eller i det publika repot.

## Enklare ändringar

Vanliga ändringar görs i tydliga innehållsfiler i stället för inne i programkoden:

| Ändring | Fil |
|---|---|
| Företagsnamn, adress, telefon och e-post | `content/company.json` |
| Webbplatsens rubriker, texter och erbjudanden | `content/site.json` |
| Adminmeny, moduler och utvecklingsplan | `content/admin.json` |
| Räkenskapsår, K2, moms, lön och lager | `config/rolands-business-decisions.json` |

Se [den enkla redigeringsguiden](docs/EDITING.md). Projektadmin innehåller dessutom ett formulär för vanliga webbplatstexter, lokal förhandsvisning och export av en färdig `site.json`.

## Exakt penningmodell

Alla nya ekonomifunktioner använder `packages/accounting/money.js` som gemensam kärna:

- belopp lagras som heltal i ören,
- kvantiteter stöder upp till tre decimaler,
- moms beräknas per rad och grupperas per momssats,
- svenska decimaler med komma eller punkt accepteras,
- osäker precision och för stora värden stoppas i stället för att gissas.

Projektadmin har en interaktiv öreskalkylator som använder exakt samma modul som kommande fakturering, lager och bokföring. Se [penningmodellens dokumentation](docs/MONEY-DOMAIN.md).

## Ny projektstruktur

```text
apps/
  website/               Ny publik webbplats
  admin/                 Projektadmin och innehållsförhandsvisning
packages/
  accounting/            Gemensamma ekonomiska domänregler, med öresprecision
  shared/browser/        Delade, små webbläsarverktyg
content/                  Redigerbara texter och företagsuppgifter
config/                   Fastställda verksamhetsbeslut
public/                   Tidigare fungerande system som migreringsreferens
scripts/                  Validering, bygge och lokal förhandsvisning
test/                     Automatiska tester
```

Den tidigare versionen ligger kvar under `/legacy/` medan nya delar byggs från grunden. Detta minskar risken: varje ny modul kan jämföras med befintliga affärsflöden innan den gamla tas bort.

## Automatisk publicering

När en ändring slås ihop till `main` sker följande:

1. Innehållsfiler valideras.
2. JavaScript syntaxkontrolleras.
3. Bokförings-, säkerhets-, penning- och grundtester körs.
4. Produktionsberoenden granskas.
5. En statisk demo byggs.
6. GitHub Pages publiceras automatiskt.

En felaktig innehållsfil eller ett testfel stoppar publiceringen.

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

Den gemensamma datamodellen i ören är nu påbörjad och används i en fungerande kalkylator. Nästa tekniska lager är personliga användare och roller, följt av verifikationsmotor, reskontra, bank, lager, lön och rapportering som separata moduler. Se [målarkitekturen](docs/ARCHITECTURE-REBUILD.md) och [verksamhetsbesluten](docs/VERKSAMHETSBESLUT.md).

Skarp drift kommer senare att använda samma GitHub-repo men en riktig backend, transaktionsdatabas och skyddad dokumentlagring. GitHub förblir källan för programmet – inte databasen för företagets bokföring.
