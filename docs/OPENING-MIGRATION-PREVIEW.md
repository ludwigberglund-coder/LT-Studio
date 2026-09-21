# Systembyte – preview av ingående reskontra

## Syfte

Innan ett befintligt företag flyttas till LT Studio måste ingående balans och öppna kund- och leverantörsposter kunna kontrolleras mot varandra.

Preview-endpointen är **endast en förhandskontroll** och skriver ingen affärsdata. Sedan PR #354 finns även ett separat, uttryckligt bekräftat importflöde som använder samma kontroller innan något skrivs.

## API

`POST /api/v1/accounting/opening-migration/preview`

Kräver:

- personlig företagsinloggning,
- giltig CSRF-token,
- åtkomst till bokföringsvyn.

Previewn returnerar fortsatt `executionSupported: false` eftersom just preview-anropet aldrig ska kunna genomföra import. En godkänd preview kan därefter skickas till den separata import-endpointen enligt `docs/OPENING-MIGRATION-IMPORT.md`.

## Underlag

Payload innehåller:

- `year`,
- `postingDate` – måste vara 1 januari valt år,
- `lines` – komplett balanserad ingående balans i klass 1–2,
- `receivables` – öppna kundfakturor,
- `payables` – öppna leverantörsfakturor.

Varje öppen post anger bland annat:

- kund- eller leverantörsnummer,
- fakturanummer,
- ursprungligt fakturadatum,
- förfallodatum,
- totalbelopp i ören,
- öppet belopp i ören.

## Kontroller

Previewn stoppar underlaget om exempelvis:

- debet och kredit inte balanserar,
- andra konton än balanskonton används,
- konto 1510 inte exakt motsvarar summan av öppna kundposter,
- konto 2440 inte exakt motsvarar summan av öppna leverantörsposter,
- kund- eller leverantörsnummer saknas i det inloggade företaget,
- fakturanummer dubblas i paketet,
- fakturan redan finns i företaget,
- fakturadatum är ogiltigt eller inte avser tiden före systemstart,
- öppet belopp är större än ursprungligt fakturabelopp,
- det redan finns ingående balans eller andra verifikationer i året.

Masterdata kontrolleras strikt med `company_id`. Ett nummer som bara finns i ett annat företag behandlas som saknat och inga uppgifter om det andra företaget returneras.

## Kontrollsummor

Previewn visar separat:

- totalt debet och kredit,
- öppna kundposter,
- nettobelopp på 1510,
- differens 1510 mot kundreskontra,
- öppna leverantörsposter,
- nettobelopp på 2440,
- differens 2440 mot leverantörsreskontra.

`status: "pass"` betyder endast att det inskickade paketet klarar dessa strukturella kontroller.

Det betyder **inte** att systemet har importerat eller bokfört något.

## Ingen mutation

En preview skapar inte:

- kundfakturor,
- leverantörsfakturor,
- reskontratransaktioner,
- verifikationer,
- auditposter,
- betalningar.

Tester jämför antal poster före och efter preview för att verifiera detta.

## Medvetna begränsningar

Den första previewversionen accepterar endast **positiva öppna poster**.

Kreditfakturor, kreditsaldon och andra negativa öppna poster måste hanteras i ett separat migreringsflöde innan en exekverande import kan godkännas.

Den atomiska importen av 1510/2440 tillsammans med reskontraunderlaget finns sedan PR #354 som ett separat privat API. Den är skyddad med preview-gate, uttrycklig bekräftelse, rollback, idempotens, tenant-isolering och efterföljande 1510/2440-avstämning. Preview-funktionen förblir read-only.
