# Inventering – privat dokumentlagring

Datum: 2026-09-20

## Syfte

Detta är endast en inventering av hur privata filer lagras idag.

Ingen fil flyttas i denna etapp. Ingen databasstruktur ändras. Ingen ny lagringstjänst införs.

Målet är att dokumentera exakt vad som måste bevaras innan vi senare kan flytta binärt innehåll från SQLite till skyddad objektlagring.


## Aktuell status efter inventeringen

Förberedelsen har nu gått ett steg längre utan att någon data har flyttats.

Alla tre privata filflöden har varsin SQLite-baserad intern lagringsadapter:

- `apps/api/document-content-store.js`,
- `apps/api/supplier-invoice-document-store.js`,
- `apps/api/customer-invoice-pdf-archive-store.js`.

Adaptrarna kapslar binär läsning/skrivning bakom `put`, `get` och `exists` och kräver företagskontext.

`test/storage-seam-contract.test.js` fungerar som arkitekturspärr i CI. Runtime-koden får inte börja läsa eller skriva `content_blob`, `document_blob` eller `pdf_blob` direkt utanför de godkända lagringsadaptrarna.

**Viktigt:** innehållet ligger fortfarande i SQLite. Detta är endast en teknisk gräns som gör ett framtida byte mindre riskfyllt.

## Filer som idag ligger direkt i SQLite

### 1. Dokumentarkivet

Kod: `apps/api/documents.js`

Tabellen `documents` innehåller bland annat:

- `company_id`,
- filnamn,
- MIME-typ,
- kategori,
- SHA-256,
- storlek,
- `content_blob`,
- status,
- uppladdande användare,
- tidsstämplar.

Färdigt dokumentinnehåll sparas alltså som BLOB i SQLite.

### 2. Leverantörsfakturornas original-PDF

Kod: `apps/api/payables.js`

Tabellen `supplier_invoices` innehåller bland annat:

- dokumentnamn,
- MIME-typ,
- SHA-256,
- `document_blob`.

PDF-originalet lagras direkt på leverantörsfakturan.

### 3. Kundfakturornas arkiverade PDF

Kod: `apps/api/customer-invoicing.js`

Tabellen `customer_invoice_pdf_archives` innehåller bland annat:

- `company_id`,
- faktura-id,
- filnamn,
- MIME-typ,
- `pdf_blob`,
- SHA-256,
- storlek,
- skapad tid.

Den exakta PDF som skapades vid fakturautställningen bevaras alltså i databasen.

## Säkerhetskontroller som redan finns

### Företagsisolering

Privata dokument hämtas med både:

- aktivt `company_id`,
- objektets id.

API:t hämtar `company_id` från den servervaliderade sessionen.

En klient ska därför inte kunna välja ett annat företag genom att ange ett främmande `company_id`.

### SHA-256

Alla tre centrala filflöden använder SHA-256 för integritetskontroll.

Systemet kontrollerar att lagrat innehåll fortfarande motsvarar det sparade digitala fingeravtrycket innan filen används eller visas.

### Filtyp

Dokumentarkivet kontrollerar tillåten MIME-typ och filens faktiska magiska bytes.

Leverantörsfakturor kräver PDF och kontrollerar PDF-signaturen.

### Storleksgränser

Det finns storleksgränser före lagring:

- dokumentarkivet: högst 15 MB,
- leverantörsfaktura-PDF: högst 10 MB.

### Behörighet

Nedladdning sker genom skyddade API-routes efter:

- personlig session,
- aktivt företagsmedlemskap,
- behörighetskontroll.

Filer exponeras inte som fria publika filvägar.

## Krav som inte får förloras vid framtida objektlagring

En framtida lagringslösning måste bevara minst följande:

1. varje objekt måste vara kopplat till rätt `company_id`,
2. klienten får aldrig själv bestämma lagringsnyckel eller företagsmapp,
3. åtkomst måste gå genom servervaliderad session och behörighet,
4. SHA-256 måste verifieras vid lagring och vid kritisk läsning,
5. filstorlek och MIME-typ måste bevaras i metadata,
6. fakturaoriginal får inte kunna ersättas efter att de blivit bindande,
7. kundfakturans arkiverade PDF måste fortsätta motsvara exakt den PDF som skapades vid utställandet,
8. leverantörsfakturans attest ska fortsatt vara knuten till det dokumentfingeravtryck som granskades,
9. dokumentmetadata och binärt objekt får inte kunna hamna i olika företag,
10. backup och restore måste omfatta både databasmetadata och objektinnehåll.

## Föreslagen framtida objektidentitet

Den fysiska objektlagringsnyckeln ska genereras av servern, inte av klienten.

Exempel på princip:

```text
private/
  <company-id>/
    documents/
      <document-id>
    supplier-invoices/
      <invoice-id>
    customer-invoices/
      <invoice-id>
```

Sökvägen är dock inte säkerhetsgränsen.

Den verkliga säkerheten ska fortfarande vara:

```text
session
  -> medlemskap
  -> company_id
  -> metadatauppslag
  -> behörighetskontroll
  -> objektåtkomst
```

## Metadata ska ligga kvar i databasen

Objektlagringen bör endast bära binärt innehåll.

Databasen bör fortsatt vara källan för:

- `company_id`,
- objekt-id,
- filnamn,
- MIME-typ,
- storlek,
- SHA-256,
- status,
- skapad tid,
- uppladdande användare,
- affärsrelationer,
- revisionsspår,
- lagringsnyckel eller objekt-id.

Det gör att affärsregler och tenant-isolering fortfarande kan kontrolleras transaktionellt i databasen.

## Risk vid flytt

Den största risken är inte själva filkopieringen utan att databaspost och objektlagring kommer ur synk.

Exempel:

- databasen säger att dokumentet finns men objektet saknas,
- objektet finns men metadata saknas,
- fel objekt kopplas till rätt metadata,
- rätt objekt kopplas till fel företag,
- SHA-256 ändras,
- en faktura attesteras mot ett dokument som senare byts ut.

Därför ska framtida migration vara verifierbar och återkörbar, och gammalt innehåll får inte tas bort förrän det nya objektet har verifierats.

## Nästa lilla steg

Nästa etapp ska fortfarande inte flytta några filer.

De tre lagringsgränserna och CI-spärren finns nu. Nästa lämpliga steg är att definiera en **provider-neutral objektidentitet och metadataform** som kan användas av en framtida extern adapter utan att ändra affärsreglerna.

Den etappen bör endast bestämma exempelvis:

- servergenererad objektnyckel,
- `company_id`,
- objekt-/dokument-id,
- MIME-typ,
- storlek,
- SHA-256,
- lagringsstatus.

SQLite-BLOB ska fortsatt vara den enda aktiva implementationen tills detta kontrakt är testat. Ingen extern lagring ska kopplas in i samma ändring.
