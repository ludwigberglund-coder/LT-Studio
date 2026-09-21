# ADR – extern privat objektlagring

Datum: 2026-09-21
Status: förberedande beslut, extern lagring är fortfarande avstängd

## Beslut

LT Studio ska förbereda **Cloudflare R2 med EU-jurisdiktion** som första staging-target för privat objektlagring.

Detta betyder inte att R2 aktiveras i produktion nu. Runtime-factoryn ska fortsatt endast tillåta `sqlite` tills migrationsprotokoll, återställning, staging och full verifiering är klara.

AWS S3 behålls som referens/fallback om krav på drift, compliance eller återställning gör det lämpligare före produktionssättning.

## Varför R2 utvärderas först

R2 har ett S3-kompatibelt API, stöd för en EU-jurisdiktion där objekt kan begränsas till EU och bucket locks som kan hindra radering/överskrivning under en bestämd tid eller tills vidare.

R2:s nuvarande prismodell tar inte betalt för internet-egress, vilket gör tjänsten intressant för ett mindre SaaS-system där PDF- och dokumenthämtningar kan variera.

Källor, kontrollerade 2026-09-21:

- https://developers.cloudflare.com/r2/get-started/s3/
- https://developers.cloudflare.com/r2/reference/data-location/
- https://developers.cloudflare.com/r2/buckets/bucket-locks/
- https://developers.cloudflare.com/r2/pricing/

AWS S3 är fortsatt en stark fallback. AWS har regionen `eu-north-1` i Stockholm och stöd för versionering samt Object Lock.

- https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html

## Viktig arkitekturgräns

Dagens SQLite-provider är synkron och kan delta i lokala SQLite-savepoints.

En extern S3/R2-provider är nätverksbaserad och kan inte göras atomisk tillsammans med en SQLite-transaktion. Därför får vi inte byta implementation bakom dagens synkrona kontrakt och anta att samma transaktionsgarantier gäller.

## Logisk identitet och fysisk nyckel

Den logiska identiteten för ett privat objekt är fortsatt:

```text
company_id + kind + object_id
```

Den fysiska externa lagringsnyckeln ska däremot vara versions-/innehållsspecifik:

```text
<logical-object-key>/<sha256>
```

Exempel:

```text
private/company_123/supplier-invoices/sinv_456/<sha256>
```

Detta är viktigt för leverantörsfakturor där PDF-underlaget kan ersättas före attest. En ny fil får en ny SHA och därmed en ny fysisk nyckel. Ett nätverksfel eller misslyckad databasuppdatering kan då inte skriva över bytes som databasen fortfarande refererar till med en äldre SHA.

## Kopieringsledger

`private_object_copies` används som kontrollplan för framtida migration.

En rad identifieras av:

- företag,
- objekttyp,
- objekt-id,
- SHA-256,
- target-provider.

Ledgern lagrar endast metadata och status, aldrig filbytes.

Tillstånd:

- `pending`: kopian är planerad eller redo för nytt försök,
- `failed`: senaste försöket misslyckades och felorsaken är sparad,
- `ready`: den externa kopian har verifierats och raden blir slutgiltig.

Varje omförsök använder samma innehållsspecifika lagringsnyckel och kan därför göras idempotent.

## Kommande skrivprotokoll

En framtida worker ska arbeta så här:

1. Läs och verifiera källobjektet genom befintligt lagringskontrakt.
2. Skapa eller återanvänd en `pending` ledger-rad.
3. Ladda upp objektet till den externa, privata bucketen utanför databastransaktionen.
4. Läs tillbaka objektet eller gör motsvarande stark verifiering och kontrollera storlek + SHA-256.
5. Markera ledger-raden `ready` först efter verifiering.
6. Vid fel: markera `failed`; käll-BLOB ligger kvar och omförsök använder samma nyckel.
7. Runtime fortsätter läsa SQLite tills en separat, testad cutover-etapp aktiveras.

## Säkerhetskrav för staging

När R2-staging införs ska minst följande vara obligatoriskt:

- bucket med EU-jurisdiktion,
- ingen publik bucket eller publik fil-URL,
- credentials utanför GitHub/repository,
- token begränsad till rätt bucket och minsta nödvändiga rättigheter,
- TLS för all objekttrafik,
- SHA-256-verifiering efter upload,
- inga BLOB-fält raderas efter upload,
- dokument får inte läsas från extern provider förrän ledger-status är `ready`,
- restore-drill måste omfatta både SQLite-metadata och externa objekt.

## Cutover får ske först efter

- 100 % av migrationsmanifestets objekt är verifierade,
- 100 % har en verifierad `ready`-kopia,
- dual-read/fallback är testat,
- backup och restore är testat,
- andra fiktiva kunden är verifierad,
- Rolands UAT är genomförd,
- rollback utan dataförlust är dokumenterad och testad.


## Oberoende staging-audit före cutover

En kopiering som en gång markerats `ready` får inte ensam betraktas som långsiktigt restore-bevis.

Före någon framtida cutover ska `storage:audit-r2` köras mot aktuell stagingdatabas. Auditverktyget jämför hela den aktuella SQLite-inventeringen mot ledgern och läser sedan tillbaka varje nuvarande `ready`-objekt från R2 för ny storleks- och SHA-256-verifiering.

Godkänd audit kräver att:

- SQLite-källan själv är intakt,
- varje aktuellt privat objekt har en `ready` R2-rad med exakt samma SHA,
- ledgerns logiska/fysiska nycklar och metadata fortfarande matchar,
- varje R2-objekt kan läsas tillbaka,
- återlästa bytes fortfarande matchar lagrad storlek och SHA-256,
- evidensfilen ligger privat utanför repositoryt.

Detta ersätter inte ett senare riktigt restore-test från extern objektlagring till en isolerad återställningsmiljö.
