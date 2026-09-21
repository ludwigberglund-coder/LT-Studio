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

## Migreringsinventering

Det finns nu ett läsande verifieringssteg innan någon extern objektlagring får kopplas in.

`apps/api/private-object-inventory.js` bygger ett provider-neutralt manifest över de tre privata filflödena och verifierar varje objekt mot det gemensamma kontraktet:

- serverstyrd objektnyckel med `company_id`,
- objekttyp och internt objekt-id,
- MIME-typ,
- storlek,
- SHA-256,
- skapad tid,
- om objektets binära innehåll fortfarande kan verifieras.

Manifestet innehåller aldrig själva filbytesen.

Kommandot:

```bash
npm run storage:inventory
```

öppnar SQLite-databasen read-only och returnerar JSON. Om ett objekt saknas eller inte längre matchar sitt SHA-256 markeras rapporten som `ok: false` och kommandot avslutas med felkod.

Detta är migrationsbevis, inte migrering: inget objekt kopieras, raderas eller ändras.

## Nästa steg

Fail-fast-valideringen av `PRIVATE_OBJECT_STORAGE_PROVIDER` sker nu vid API-start, och migrationsinventeringen kan verifiera nuvarande SQLite-källa innan en flytt.

Nästa säkra etapp är att designa ett **asynkront och återställningsbart skrivprotokoll** för extern objektlagring innan R2, S3 eller annan nätverksprovider aktiveras.

Det behövs eftersom dagens SQLite-provider är synkron och kan delta i lokala savepoints, medan riktig objektlagring sker över nätverk och inte kan vara atomisk i samma databastransaktion.

Den kommande etappen ska därför definiera:

- tillstånd som `pending-upload`, `ready` och `failed`,
- verifiering av storlek och SHA-256 efter uppladdning,
- återkörbara/idempotenta uppladdningar,
- hur databasmetadata och objekt hålls synkroniserade vid avbrott,
- dual-read/rollback under migration,
- att gammal SQLite-BLOB inte tas bort förrän extern kopia är verifierad,
- backup och restore för både databas och objektlagring.

Ingen extern provider ska aktiveras innan detta är testat.


## Extern kopieringsledger

Nästa kontrollplan är nu definierad i `apps/api/private-object-copy-ledger.js`.

Ledgern skapar inga externa kopior och aktiverar ingen extern runtime-provider. Den lagrar endast serverstyrd metadata för framtida kopieringsförsök och använder en innehållsspecifik fysisk nyckel:

```text
<logical-object-key>/<sha256>
```

Det gör att en ny version av exempelvis en leverantörsfaktura inte behöver skriva över en tidigare version i objektlagringen.

Tillstånden är `pending`, `failed` och `ready`. En `ready`-rad är slutgiltig och kan inte återöppnas eller ändras.

Runtime-factoryn tillåter fortfarande endast `sqlite`. `r2` och `s3` förekommer endast som planerade migrationstargets i ledgern och kan inte användas för ordinarie filåtkomst.

Nästa implementation ska vara en separat staging-worker som kan kopiera ett verifierat manifestobjekt till en extern testbucket, läsa tillbaka det, verifiera SHA-256 och först därefter markera ledger-raden `ready`. SQLite-BLOB ska ligga kvar under hela staging- och rollback-fasen.


## Idempotent kopieringsplan

`apps/api/private-object-copy-planner.js` binder nu ihop det verifierade SQLite-manifestet med kopieringsledgern.

Planeraren:

1. bygger om hela källinventeringen,
2. stoppar direkt om ett enda källobjekt inte kan verifieras,
3. skapar ledger-rader i en SQLite-savepoint,
4. återanvänder redan planerade rader vid omkörning,
5. gör inga nätverksanrop och flyttar inga bytes.

Kommandot:

```bash
npm run storage:plan-copies -- r2
```

skapar endast planeringsmetadata för R2. `s3` kan anges som alternativ migrationstarget. Ett ogiltigt target stoppas fail-closed.

Detta innebär att vi nu kan inventera källan och skapa en reproducerbar migrationsplan utan att exponera eller flytta kunddata.

Nästa steg är en separat staging-adapter/worker. Den ska ta **en redan planerad pending-rad**, ladda upp motsvarande verifierade källobjekt, läsa tillbaka objektet, kontrollera SHA-256 och först därefter markera raden `ready`.


## Asynkron staging-worker

En provider-neutral kopieringsworker finns nu i `apps/api/private-object-copy-worker.js`.

Workern tar endast en redan planerad ledger-rad och ett explicit injicerat staging-target. Den:

1. verifierar SQLite-källobjektet igen precis före kopiering,
2. kontrollerar att ledgerns fysiska nyckel fortfarande motsvarar objektets serverstyrda nyckel + SHA-256,
3. laddar upp till staging-target,
4. läser tillbaka objektet,
5. verifierar storlek och SHA-256 på den återlästa kopian,
6. markerar ledger-raden `ready` först efter lyckad verifiering,
7. markerar försöket `failed` med en säker felkod vid fel,
8. återanvänder samma immutabla lagringsnyckel vid omförsök.

En redan `ready`-markerad kopia ger ett idempotent resultat utan nya externa anrop.

**Fortfarande inte aktiverat:** ingen R2/S3-SDK, inga credentials, ingen riktig bucket, ingen extern läsning i runtime och ingen borttagning av SQLite-BLOB.

Nästa säkra etapp är därför en **R2-staging-adapter i en isolerad testmiljö**, med EU-jurisdiktion, privat bucket och minimala credentials. Den ska endast användas av staging-workern. Ordinarie systemtrafik ska fortsatt läsa och skriva SQLite tills stagingkopiering, restore och rollback har verifierats end-to-end.


## R2 EU-stagingadapter

En första riktig nätverksadapter finns nu för **Cloudflare R2 i EU-jurisdiktion**, men den är fortfarande isolerad från ordinarie runtime.

Adaptern använder R2:s S3-kompatibla API med AWS Signature Version 4 och Node:s inbyggda HTTP-stack. Inga nya runtime-dependencies behövs.

Den är fail-closed:

- `ROLLANDS_ENV` måste vara exakt `staging`,
- `R2_STAGING_ENABLED` måste vara exakt `1`,
- jurisdiction måste vara `eu`,
- endpoint genereras av servern som `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`,
- bucketnamn och account-id valideras,
- endpoint kan inte matas in fritt av klient eller miljövariabel,
- credentials hålls utanför GitHub och är icke-enumererbara i konfigurationsobjektet,
- varje PUT använder `If-None-Match: *` så en befintlig innehållsversion inte skrivs över,
- all trafik signeras med SigV4,
- redirects till annan host tillåts inte.

Cloudflare-källor som styr implementationen:

- R2 S3 API: https://developers.cloudflare.com/r2/get-started/s3/
- EU-jurisdiktion: https://developers.cloudflare.com/r2/reference/data-location/
- R2 API tokens: https://developers.cloudflare.com/r2/api/tokens/
- S3-kompatibilitet och conditional PUT: https://developers.cloudflare.com/r2/api/s3/api/

Signeringsalgoritmen testas i CI mot AWS officiella S3 SigV4-testvektor, inte bara mot lokala mocks.

### Credentials för staging

Följande ska sättas som hemligheter i stagingmiljön, aldrig committas:

```text
ROLLANDS_ENV=staging
R2_STAGING_ENABLED=1
R2_STAGING_JURISDICTION=eu
R2_STAGING_ACCOUNT_ID=<cloudflare-account-id>
R2_STAGING_BUCKET=<privat-eu-staging-bucket>
R2_STAGING_ACCESS_KEY_ID=<bucket-scoped-access-key>
R2_STAGING_SECRET_ACCESS_KEY=<bucket-scoped-secret>
```

Token ska ha **Object Read & Write** och begränsas till just staging-bucketen.

När en ledger-rad redan har planerats kan exakt ett objekt stagingkopieras med:

```bash
npm run storage:copy-one-r2 -- <companyId> <kind> <objectId> <sha256>
```

Kommandot visar endast identitet, status och verifieringsresultat. Det skriver inte ut credentials eller filbytes.

**Ingen automatisk batchkörning och ingen runtime-cutover är aktiverad.** Nästa steg efter riktig stagingkonfiguration är ett kontrollerat integrationstest mot en tom privat EU-bucket med fiktiv kunddata, därefter restore/rollback-test.
