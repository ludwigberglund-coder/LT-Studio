# Webbaserad UAT-miljö

Status: 2026-10-05. Detta dokument beskriver den **aktuella delade UAT-miljön**.

## Aktuell arkitektur

LT Studios delade UAT körs som:

- **GitHub `main`** – source of truth för kod, tester, dokumentation, Supabase-migrationer och Edge Functions.
- **GitHub Pages** – webbläsargränssnittet.
- **Supabase-projektet `LT-Studio` i `eu-north-1`** – PostgreSQL, Auth, MFA, RLS, Realtime, privat Storage, RPC:er och Edge Functions.
- **Node/SQLite i `apps/api/`** – äldre/lokal referens- och regression-runtime, inte backend för den delade UAT:n.

Railway används inte av den aktuella delade UAT:n.

Den kanoniska tekniska beskrivningen finns i `docs/SUPABASE-UAT.md` och den verifierade GitHub ↔ Supabase-statusen i `docs/SUPABASE_SOURCE_OF_TRUTH.md`.

## Öppna UAT

Kundportal:

`https://ludwigberglund-coder.github.io/LT-Studio/uat/`

Första UAT-aktivering och MFA:

`https://ludwigberglund-coder.github.io/LT-Studio/portal/uat-setup.html`

## Datapolicy

Miljön är **syntetisk-only**.

Följande får inte användas i UAT:

- riktiga kund- eller leverantörsuppgifter,
- riktiga organisationsnummer eller personuppgifter,
- riktiga fakturor eller banktransaktioner,
- riktiga löneuppgifter,
- riktiga privata dokument/PDF:er,
- produktions- eller pilotbackuper,
- secrets eller privata credentials.

UAT-fakturor ska vara tydligt markerade som demo och får inte kunna misstas för verkliga betalningsunderlag.

## Säkerhetsmodell

- Personliga Supabase Auth-konton används.
- Delad UAT kräver MFA/AAL2.
- Företagsåtkomst styrs genom `company_memberships` och RLS.
- Ekonomiska kärnflöden går genom kontrollerade RPC:er/buntflöden i stället för fria browser-skrivningar.
- Privata PDF-original lagras i den privata Supabase Storage-bucketen `lt-documents`.
- LT Studio-operatorflöden går genom den MFA-skyddade Edge Functionen `operator-admin`.
- Manuell kundinbetalning går genom Edge Functionen `manual-customer-payment`; browserrollen ska inte anropa den privilegierade server-RPC:n direkt.

## Source-of-truth-regel

En permanent ändring i databas, RLS, RPC, trigger, Storage, Realtime eller Edge Functions får inte bara göras i Supabase Dashboard. Motsvarande versionsstyrd ändring ska finnas i GitHub.

Om en akut live-ändring görs först blir GitHub-reconciliation P0 tills `main` åter är exakt source of truth.

## Vad denna UAT inte bevisar

GitHub Pages + Supabase-UAT är inte ett godkännande för verkliga ekonomiska data eller skarp pilot.

Separat före pilot krävs bland annat:

- färdig och aktuell staging/pilotarkitektur,
- verifierad backup/restore-strategi för den valda produktionsarkitekturen,
- övervakning och incidentrutiner,
- säkerhetsgranskning och manuella GitHub Security-kontroller,
- redovisnings-/SIE-/originalarkivsvalidering,
- uttryckligt produktions-/pilotgodkännande.

Äldre dokument som beskriver Railway, Node/SQLite-serverdrift eller VM/R2 som den aktuella UAT-arkitekturen är legacy-referenser och får inte användas för att ändra dagens UAT.
