# Privat pilotserver, PDF och webbplatsutkast

Granskning: 2026-09-18. Detta stänger avgränsade tekniska fel, inte hela pilotbeslutet. **Verklig pilotdrift är fortfarande NO-GO.**

## Två olika miljöer

GitHub Pages är en separat statisk demo med fiktiva uppgifter. `npm start` startar den privata Node/SQLite-servern. Den privata servern tillåter inte att en adressparameter som `?demo=1` växlar till demodata. Demo- och UAT-hjälpfiler, gamla `/admin`- och `/legacy`-sidor serveras inte därifrån. Menyn visar endast understödda verktyg för företagets medlemmar. Kundreskontra leder till API-vyn, inte den fristående demon.

Kod för att visa portalen är inte hemlig. Privatekonomiska uppgifter skyddas genom personlig session, medlemskap och företagskontroll i API:t. Ingen fullständig automatisk klassificering/rensning av tidigare inlagda demoposter påstås; befintlig databas måste granskas före pilot.

## Bindande startkontroll

PR #67 inför kontrollen i `apps/api/private-runtime.js`. Den körs automatiskt om `NODE_ENV=production` eller `ROLLANDS_ENV` är `pilot`/`production`. Det går inte att undvika den genom att binda till loopback bakom en HTTPS-proxy.

`pilot-preflight.js` kräver bland annat absolut databas- och backupsökväg utanför repot, Secure-cookies, angivna värdnamn, kryptonyckel som inte är en platshållare och avstängda demodata. Symlänkar kontrolleras. Nya databasfiler skapas med rättighet 600. En befintlig osäker fil ändras inte tyst; starten stoppas.

Detta bevisar inte att HTTPS, DNS, brandvägg, backup-kryptering eller extern övervakning fungerar. De provas i vald driftmiljö före pilot. Se `.env.example` och `BACKUP-RESTORE-PILOT.md`. Lägg aldrig riktiga nycklar, lösenord eller affärsdata i GitHub.

## PDF vid attest

Originalfilen hämtas från `/api/v1/payables/invoices/:id/document` med aktuell session. Fel företag ger 404. En tillåten PDF kan visas i en iframe från samma webbplats, med en separat länk för ny flik. PDF-innehållet ritas inte om.

Säkerheten stängs inte av: portalens script får fortfarande bara laddas lokalt, `object-src 'none'` kvarstår och PDF-svaret tillåter endast `frame-ancestors 'self'`/`SAMEORIGIN`. Det är olika kontroller för vilket dokument en sida får rama in och vem som får rama in dokumentet. Källa: https://www.w3.org/TR/CSP/ (kontrollerad 2026-09-18).

Kundfakturans befintliga PDF-generator använder den låsta lokala `pdf-lib`-distributionen från `npm ci`, inte extern CDN. Att PDF-knappen fungerar är **inte** samma sak som att exakt utfärdad PDF arkiveras långsiktigt. Den arkivfrågan kvarstår.

## Spara, granska och bevara webbplatsutkast

1. Användaren ändrar text. Formuläret visar osparade ändringar.
2. Spara utkast skickar texten och den lästa utkastversionen till servern. Utkast och audit-händelse sparas i samma databastransaktion.
3. Om någon annan redan sparat nekas den gamla versionen med 409. Formulärets text behålls. Användaren kan kopiera texten eller uttryckligen hämta senaste sparade versionen.
4. Vid nätverksfel eller timeout behålls inmatningen. Ett nätverksfel bevisar inte att servern aldrig sparade; hämta senaste version innan nytt försök.
5. Förhandsvisa sparar först och öppnar `/website-preview/`. Den sidan kräver inloggning och `website.manage` och visar det aktuella företagets serverutkast. Den läser inte lokala demo-utkast.
6. Spara publicerad CMS-version skapar en ny versionspost med kontroll av både utkast och senaste publicerade version. Två samtidiga likadana publiceringar kan inte skapa två versioner.
7. Återställning av en gammal CMS-version skapar nytt utkast, inte en tyst omskrivning av publicerat innehåll.

**Publicerad CMS-version betyder här sparad i databasen, inte uppdaterad GitHub Pages eller extern produktionshemsida.** Gränssnittet säger detta uttryckligen. Koppling till den verkliga publika driften är fortfarande ett separat arbete.

Utkastets versionsräknare tillkommer via en repeterbar schemauppdatering som inte ersätter befintligt innehåll. Ingen privat utkastdata läggs i localStorage av den nya förhandsvisningen.

## Testbevis och avgränsning

- `test/private-runtime.test.js`: bindande startkontroll, demo-query, blockerade filer, symlänkar, filrättigheter och privata menylänkar.
- `test/private-workflows-http.test.js`: riktiga HTTP-anrop med MFA/session/CSRF, företags- och medlemskapskontroll, versionskonflikt, parallell publicering, auditfel/rollback, PDF-innehåll och repeterbar migrering.
- `test/private-workflows-browser.cjs`: webbläsarflöde mot riktig API-server med fiktiva uppgifter och säkerhetsregler aktiva. Inloggning, utkast, omladdning, privat förhandsvisning, nätverksfel, konflikt och PDF-knappar provas. Körs i CI, inte via demo/proxy som ersätter API-svar.

Lokala Node 22-kontroller ersätter inte projektets Node 24-CI. Den lokala webbläsarmiljön blockerar localhost; webbläsarverifieringen görs därför i CI utan att kringgå policyn. Resultat, skärmbilder och test-PDF:er sparas som `rollands-invoice-navigation-qa`. Testdata är påhittade.

Fullt Rolands-UAT, verklig driftsäkerhet, källanknutna redovisningsrättelser, moms/ränta, originalarkiv och extern backup återstår. Se `ROLANDS-PILOT-READINESS-CHECKLIST.md`.
