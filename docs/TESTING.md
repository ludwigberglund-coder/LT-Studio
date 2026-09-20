# Testning

## Automatiska tester

```powershell
npm ci
npm test
```

Testsviten täcker bland annat:

- kund- och leverantörsreskontra,
- delbetalning, överbetalning, kvittning och omföring,
- fakturering, PDF och idempotens,
- balanserade verifikationer och unika buntnummer,
- atomisk lagring, backupåterläsning och trasig revisionskedja,
- tom normalstart utan automatisk demodata,
- administratörsnyckel och sessionscookie,
- säkerhetsrubriker, innehållstyp, storleksgräns, värdnamnskontroll och sökvägsskydd,
- CSV-formelinjektion,
- driftspärr och diagnostik när datalagret är korrupt.

`test/receivables-browser.cjs` är ett separat webbläsartest som kräver Playwright och Microsoft Edge i testmiljön.

## CI i GitHub

`.github/workflows/ci.yml` kör vid pull request och push till `main`:

1. `npm ci` från `package-lock.json`.
2. Syntaxkontroll av all JavaScript-källkod.
3. `npm test`.
4. `npm audit --omit=dev --audit-level=high`.
5. Byggnad av den statiska webbplatsen.
6. Kontroll att `dist/` motsvarar `public/`.
7. Tillfällig granskningsartefakt utan databas, hemligheter och installerade beroenden.

## Datakontroll

Mot ett valt datalager:

```powershell
$env:ROLLANDS_DATA_DIR = 'C:\RollandsData'
npm run data:check
```

Kommandot ska avslutas med status 0 innan uppgradering eller driftstart. Varningar om demodata eller olåsta perioder måste bedömas manuellt.

## Obligatoriska manuella acceptanstester före produktion

1. Skapa, kreditera och betala fakturor med verklighetstrogna anonymiserade belopp.
2. Kontrollera varje verifikation mot förväntad debet/kredit och moms.
3. Återställ en säkerhetskopia i en separat miljö och jämför kontrollsummor och saldon.
4. Importera bankens exakta CAMT/BAM-varianter, inklusive dubbletter, valuta, återföringar och samlingsposter.
5. Kontrollera periodlås, behörighetsseparation och attest med flera personliga användare.
6. Prova export/import mot mottagande redovisnings- och revisionssystem.
7. Låt redovisningskonsult/revisor godkänna kontoplan, momsflöden, bokslut och arkiveringsrutiner.
8. Genomför extern säkerhetsgranskning av den verkliga driftsmiljön.

## Miljönotering

Server- och PDF-tester kräver `pdf-lib`. Beroendet ska installeras via `npm ci`; det finns inte längre någon maskinspecifik reservsökväg. En miljö som inte kan nå npm-registret kan fortfarande köra syntaxkontroll och fristående tester, men det ersätter inte den fullständiga CI-körningen.
