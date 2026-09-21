# Security Policy

LT Studio hanterar kod för ekonomiflöden, autentisering, företagsisolering, dokument och bokföringsrelaterad historik. Säkerhetsfynd ska därför behandlas som privata tills de är verifierade och åtgärdade.

## Rapportera inte känsliga säkerhetsfynd i publika issues

Öppna **inte** en publik GitHub issue, discussion eller PR med:

- fungerande exploitsteg mot en verklig miljö,
- användarnamn, sessionsvärden, tokens, API-nycklar eller andra secrets,
- kunduppgifter, personuppgifter, fakturor, löneuppgifter eller bankuppgifter,
- databasfiler, backupfiler eller riktiga dokument,
- detaljer som gör det möjligt att kringgå autentisering, MFA, tenant-isolering eller bokföringsskydd innan en fix finns.

Om GitHubs **Private vulnerability reporting** är aktiverat för repositoryt ska det användas i första hand.

Om det inte är aktiverat ska fyndet lämnas till repositoryägarna genom den redan etablerade privata kontaktvägen mellan utvecklarna. Dela bara den minsta mängd information som krävs för att reproducera och bedöma felet.

## Information som bör finnas med

En bra privat rapport innehåller:

1. vilken commit/version som testades,
2. vilken del av systemet som berörs,
3. förväntat beteende,
4. faktiskt beteende,
5. minsta reproduktionssteg med fiktiva/testdata,
6. uppskattad påverkan,
7. om fyndet kräver autentisering, särskild företagsåtkomst eller operatoråtkomst,
8. om några riktiga secrets eller verkliga person-/företagsdata kan ha exponerats.

Bifoga inte mer känslig data än nödvändigt. Maskera tokens, personuppgifter och affärsdata.

## Kritiska fynd

Följande behandlas som särskilt brådskande:

- kringgående av inloggning, MFA eller sessionsskydd,
- åtkomst till ett annat företags data,
- möjlighet att ändra eller radera bokförings-/audithistorik,
- möjlighet att manipulera faktura-, dokument- eller backupintegritet utan upptäckt,
- exponering av hemligheter eller privata databas-/backupfiler,
- fjärrkörning av kod,
- möjlighet att starta pilot/produktion utan obligatoriska safety/readiness-gates.

Vid ett sådant fynd ska ingen skarp pilot aktiveras eller fortsätta innan påverkan är förstådd och lämplig fix/verifiering finns.

## Hantering av fynd

Säkerhetsfixar följer samma source-of-truth-princip som övriga ändringar:

1. skapa separat branch,
2. lägg till ett regressionstest som reproducerar felet där det är möjligt,
3. implementera minsta säkra fix,
4. kör full CI,
5. merge via PR,
6. verifiera fixen på aktuell commit,
7. uppdatera relevant readiness-/driftdokumentation.

Ett säkerhetsfynd räknas inte som stängt bara för att koden är ändrad. Om felet kan ha påverkat secrets, data eller drift krävs även bedömning av rotation, återställning, incidenthantering och eventuell ytterligare verifiering.

## Secrets och riktiga data

Repositoryt får endast innehålla kod, tester, dokumentation, publika mallar och fiktiva testvärden.

Lägg aldrig in:

- riktiga lösenord eller MFA-hemligheter,
- API-/R2-/bank-/e-postcredentials,
- sessionscookies eller access tokens,
- riktiga kundregister eller personuppgifter,
- fakturaoriginal eller löneunderlag,
- SQLite-databaser,
- krypterade eller okrypterade produktionsbackuper,
- privata UAT-/signoff-/monitorerings-/audit-evidensfiler.

Om en riktig hemlighet misstänks ha committats ska den behandlas som komprometterad tills motsatsen är verifierad. Historikradering ersätter inte credential-rotation.

## Supported versions

Projektet är fortfarande i Production Readiness Phase 1. Endast aktuell `main` och uttryckligen godkända release-commits används som säkerhetsreferens. Äldre demo-, legacy- eller featurebrancher ska inte betraktas som supportade driftversioner.

## Disclosure

Publik teknisk beskrivning av ett säkerhetsfel görs först när:

- fixen är mergad och verifierad,
- eventuell credential-rotation eller incidentåtgärd är klar,
- publiceringen inte utsätter en ännu oskyddad miljö eller kunddata för ökad risk.
