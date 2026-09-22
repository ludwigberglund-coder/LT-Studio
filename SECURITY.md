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

Om en riktig hemlighet misstänks ha committats ska den behandlas som komprometterad tills motsatsen är verifierad. Historikradering ersätter inte credential-rotation. Följ den konkreta rotationsrutinen i `docs/SECRET-ROTATION.md`.

Utvecklings- och agentreglerna som förhindrar nya exponeringar finns i `AGENTS.md`. Cloudflare-arkitekturen och dess begränsningar finns i `docs/CLOUDFLARE-FREE-SECURITY.md`.

## Filuppladdningar

Användaruppladdningar är en särskilt känslig attackyta. Följande policy gäller för LT Studio:

- endast PDF-filer får laddas upp av användare,
- maximal filstorlek är 10 MB,
- både filändelse och faktisk PDF-signatur kontrolleras på servern,
- JPEG, PNG, SVG, HTML, JavaScript, Office-filer, ZIP/arkiv och körbara filer är förbjudna,
- krypterade PDF-filer avvisas eftersom innehållet inte kan säkerhetskontrolleras,
- PDF-funktioner för JavaScript, automatiska actions, launch, formulär/XFA, RichMedia och inbäddade filer avvisas,
- användaruppladdade original lagras som privata blobs och får aldrig publiceras som statiska webbassets,
- användaruppladdade PDF:er levereras som nedladdning (attachment) med sandboxad CSP, inte som inline-innehåll från LT Studios origin,
- servern får aldrig exekvera, importera eller require:a uppladdat användarinnehåll.

Om stöd för en annan filtyp någon gång behövs ska det behandlas som en ny säkerhetsfunktion med separat threat model, validering, tester och PR. Det får inte införas genom att bara utöka en MIME-lista eller ett HTML `accept`-attribut.


## Skydd av `main` i GitHub

`main` är projektets Source of Truth och ska normalt endast ändras via:

`branch -> Pull Request -> obligatorisk CI -> review -> merge`.

Repositoryägaren ska använda ett GitHub Ruleset eller motsvarande branch protection för `main` med följande mål:

- Pull Request krävs före merge.
- Required status check `test` från workflow `Quality and security checks` måste vara grön.
- Required status check `CodeQL JavaScript` från workflow `CodeQL security analysis` måste vara grön.
- Öppna review-konversationer måste vara lösta.
- Force-push till `main` är blockerad.
- Radering av `main` är blockerad.
- PR-branchen ska vara uppdaterad mot senaste `main` före merge när GitHub-stödet för detta används. Detta minskar risken för att en PR mergas på gamla gröna resultat när flera agenter arbetar parallellt.
- Nya commits efter approval ska göra tidigare approval inaktuellt när reviewkravet används.

Normal utveckling ska fortfarande fungera för behöriga utvecklare genom att skapa branch, pusha till branchen, öppna PR, låta CI köra och därefter merga när reglerna är uppfyllda.

### Admin- och emergency-modell

Reglerna bör gälla även repository-admins i normalt arbete. En generell bypass för alla administratörer ska inte användas.

Om GitHub-planen och ruleset-funktionen tillåter en separat emergency-bypass ska den begränsas till minsta möjliga krets och endast användas vid ett verkligt incidentläge där den normala PR-kedjan inte kan användas. Varje sådan bypass ska dokumenteras i efterhand med orsak, vilka commits som berördes och vilken verifiering som gjordes.

Rulesetet får inte kräva signerade commits så länge den nuvarande ChatGPT/GitHub-integrationen inte konsekvent kan skapa signerade commits. GitHub Pages-deployment ska inte vara en merge-gate.

### Verifiering av rulesetet

Skyddet räknas som färdigt först när GitHub faktiskt visar aktivt skydd och följande har verifierats:

1. en normal PR med grön `test` och `CodeQL JavaScript` kan mergas,
2. en PR med röd obligatorisk check inte kan mergas,
3. direkt push till `main` blockeras enligt reglerna,
4. en PR utan godkänd CodeQL-check inte kan mergas,
5. beteendet efter ny commit efter approval är kontrollerat,
6. branch deletion och force-push är blockerade.

Den öppna repository-governance-blockeraren spåras i GitHub issue #226. Issue får inte stängas enbart för att dokumentationen finns; faktisk GitHub-konfiguration och praktiska tester krävs.

## Supported versions

Projektet är fortfarande i Production Readiness Phase 1. Endast aktuell `main` och uttryckligen godkända release-commits används som säkerhetsreferens. Äldre demo-, legacy- eller featurebrancher ska inte betraktas som supportade driftversioner.

## Disclosure

Publik teknisk beskrivning av ett säkerhetsfel görs först när:

- fixen är mergad och verifierad,
- eventuell credential-rotation eller incidentåtgärd är klar,
- publiceringen inte utsätter en ännu oskyddad miljö eller kunddata för ökad risk.
