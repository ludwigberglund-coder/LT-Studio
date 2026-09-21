# Inventering – privat dokumentlagring

Datum: 2026-09-21

## Syfte

Detta är endast en inventering av hur privata filer lagras idag.

Ingen fil flyttas i denna etapp. Ingen databasstruktur ändras. Ingen ny lagringstjänst införs.

Målet är att dokumentera exakt vad som måste bevaras innan vi senare kan flytta binärt innehåll från SQLite till skyddad objektlagring.


## Aktuell status efter inventeringen

Förberedelsen har nu gått från inventering till ett gemensamt internt lagringskontrakt utan att någon data har flyttats.

Gemensamma kontrakt:

- `apps/api/private-object-contract.js` definierar provider-neutral objektidentitet och metadata,
- `apps/api/private-object-store-contract.js` definierar ett gemensamt `put`/`get`/`exists`-gränssnitt och verifierar storlek samt SHA-256 innan skrivning.

Alla tre privata filflöden har dessutom varsin SQLite-providerbrygga:

- `apps/api/sqlite-document-private-object-provider.js`,
- `apps/api/sqlite-supplier-invoice-private-object-provider.js`,
- `apps/api/sqlite-customer-invoice-private-object-provider.js`.

Runtime för dokumentarkiv, leverantörsfakturans PDF och kundfakturans arkiverade PDF går nu genom den centrala `apps/api/private-object-store-factory.js`.

Factoryn:

- väljer provider centralt,
- använder `sqlite` som enda tillåtna och förvalda provider,
- mappar objekttyp till rätt SQLite-brygga,
- stoppar okända providers fail-closed.

Bryggorna använder fortfarande de befintliga SQLite-adaptrarna bakom kontraktet.

De underliggande SQLite-adaptrarna är fortsatt:

- `apps/api/document-content-store.js`,
- `apps/api/supplier-invoice-document-store.js`,
- `apps/api/customer-invoice-pdf-archive-store.js`.

`test/storage-seam-contract.test.js` fungerar som arkitekturspärr i CI. Den stoppar direkt runtime-åtkomst till privata BLOB-fält och verifierar dessutom att alla tre affärsflöden använder den centrala factoryn i stället för att importera provider eller provider-kontrakt direkt.

**Viktigt:** allt binärt innehåll ligger fortfarande i SQLite. Ingen extern objektlagring är aktiverad och ingen kunddata har migrerats.

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

Metadataformen, provider-kontraktet, de tre SQLite-bryggorna, den centrala factoryn och runtime-kopplingen finns nu.

Nästa lämpliga steg är **fail-fast validering av lagringskonfiguration vid API-start**.

Den etappen ska:

- validera `PRIVATE_OBJECT_STORAGE_PROVIDER` när API:t startar,
- använda `sqlite` som standard om variabeln saknas,
- stoppa uppstart direkt om en okänd provider anges,
- inte ändra databasstruktur eller API,
- inte flytta några filer,
- inte införa S3-, R2- eller annan extern implementation.

Det gör att en felaktig produktionskonfiguration upptäcks vid start i stället för först när någon försöker läsa eller skriva en privat fil.

Först efter den kontrollen bör en separat etapp utvärdera en extern objektlagringsprovider.
