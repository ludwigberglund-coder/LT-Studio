# Cybersecurity audit – 2026-09-22

Scope: aktuell GitHub-kod i LT-Studio, med fokus på tenant-isolering, autentisering, sessionssäkerhet, API-auktorisering, inputvalidering, filuppladdning, XSS/CSRF, databasintegritet, bokföringsintegritet, secrets, CI/CD, dependencies, backup/restore och repository-säkerhet.

## Säkerhetsstatus

Ingen bekräftad Critical-sårbarhet hittades i den granskade aktuella kodbasen.

Tenant-isoleringen är ett av projektets starkaste områden: API-frågor är företagsfiltrerade, databasen har tenant-integritetskontroller/triggers och befintliga HTTP-tester verifierar att användare i ett företag inte kan läsa eller ändra ett annat företags objekt i de testade flödena.

Autentisering och sessionshantering har flera skyddslager: scrypt-lösenordshashning, MFA/TOTP, HttpOnly/SameSite/Secure-cookies, CSRF-skydd, sessionstimeout och sessionsåterkallelse vid credential-rotation/recovery.

Kvarvarande pilotrisker är främst least privilege inom samma företag och GitHub-governance.

## Critical

Inga bekräftade Critical-fynd i denna granskning.

## High

### 1. Least privilege saknas per företagsmedlemskap

Bekräftat i den centrala auktoriseringen och befintliga tester: alla aktiva personliga medlemmar i ett företag passerar i praktiken alla definierade permissions.

Detta är inte ett tenant-bypass. Company A hålls fortfarande separerat från Company B. Risken är att en användare inom samma företag får bredare server-side rättigheter än arbetsrollen kräver, även för känsliga ekonomiska åtgärder.

Spåras i issue #399.

### 2. `main` saknar tekniskt branch/ruleset-skydd

GitHub API visar `protected: false` och repository-rulesets är tomma. Processen branch -> PR -> CI -> main används, men GitHub tvingar inte fram den tekniskt.

Detta är redan dokumenterat i issues #226 och #373 samt `docs/GITHUB-REPOSITORY-SECURITY.md`.

## Medium

### Export-API använde fel permission

`apps/api/exports-router.js` använde `reports.view` trots att åtkomstmodellen har `reports.export`.

Fix finns i PR #398 och har regressionstest. Merge får ske först efter grön CI.

## Low / defence in depth

- Repositoryt är publikt. Detta är inte i sig en sårbarhet om inga secrets eller kunddata finns i Git, men ökar kraven på secret scanning, granskningsdisciplin och collaborator-governance. Spåras i #301.
- In-memory rate limiting får inte behandlas som globalt skydd i en framtida multi-instance-deployment. Projektet har redan dokumenterat detta och behåller origin-rate-limits som försvarslager.

## Verifierade skydd

- Tenant-id följer databasobjekt och verifieras server-side.
- Tenant-integrity triggers förhindrar flera typer av cross-tenant-referenser/flytt av objekt.
- Personliga sessioner hämtas server-side och knyts till aktivt membership.
- Lösenords-/MFA-rotation och account recovery återkallar sessioner.
- CSRF krävs på state-changing privata API-anrop.
- Säkra cookies används i skyddade miljöer.
- Filuppladdning är PDF-only, max 10 MB, signatur/struktur kontrolleras och aktiva PDF-funktioner avvisas.
- Uppladdade PDF:er levereras som attachment med restriktiv CSP.
- Säkerhetsheaders och CSP finns i modern API-runtime.
- Legacy-servern blockeras från staging/pilot/production.
- Parametriserad SQL används genomgående i affärsfrågor; granskade dynamiska SQL-delar bygger på interna allowlists, citerade schemaidentifierare eller genererade savepoint-namn.
- Ingen runtime-användning av `eval` eller `new Function` verifierades i den granskade applikationskoden.
- CI innehåller testsuite, syntaxkontroll, dependency audit, secret scans, runtime execution scan, statisk build-kontroll och browserflöden.
- CodeQL finns separat.
- GitHub Actions är pinnade till immutable commit-SHA i granskade workflows.
- Backup/restore-kedjan innehåller checksummeverifiering, krypterade backuper, offsite-evidence och restore drills/readiness-gates.
- Bokföringsflöden använder tenant-scope, transaktioner, audit trail, periodlås och spårbara rättelser.

## Inte fullt verifierbart via nuvarande GitHub-anslutning

GitHubs känsliga endpointfamiljer för Dependabot-, code-scanning- och secret-scanning-alertlistor exponeras inte av den anslutna GitHub-fetch-funktionen. CI-konfigurationen för dessa skydd har granskats, men denna audit ska därför inte påstå att GitHub-kontot har noll aktiva alerts utan separat UI/admin-verifiering.

## Pilotblockerare

Före riktig pilot med flera användare och riktiga ekonomidata:

1. inför server-side least-privilege per membership enligt #399,
2. aktivera tekniskt skydd av `main` enligt #226/#373,
3. verifiera aktiva GitHub security alerts i GitHub UI,
4. genomför staging UAT samt bevisad backup + restore drill på release-commit,
5. verifiera driftens monitoring/log transport och incidentväg.

## Slutsats

De granskade skydden mot cross-tenant access, sessionsmissbruk, farliga filuppladdningar och tyst bokföringsmanipulation är betydligt starkare än en normal tidig prototyp.

Systemet ska ändå inte beskrivas som helt säkert. De två viktigaste kvarvarande strukturella riskerna är least privilege inom samma kundföretag och att GitHub `main` ännu inte är tekniskt skyddad.
