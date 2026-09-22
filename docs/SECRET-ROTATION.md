# Secret- och credential-rotation

Detta dokument beskriver hur LT Studio hanterar API-nycklar, krypteringsnycklar och tredjepartscredentials utan att lägga hemligheter i GitHub.

## Grundregel

En credential som har funnits i GitHub, browserkod, CI-logg, skärmbild eller annan obehörig plats ska behandlas som komprometterad. Att bara radera den ur Git-historiken gör den inte säker igen.

Rotation betyder alltid:

1. skapa en ny credential hos rätt leverantör/secret manager,
2. ge den minsta behörighet som krävs,
3. uppdatera den privata driftmiljön,
4. verifiera att den nya credentialen fungerar,
5. återkalla den gamla credentialen,
6. kontrollera loggar och säkerhetshändelser efter oväntad användning,
7. dokumentera att rotationen är genomförd utan att dokumentera själva hemligheten.

## LT Studios autentiseringskrypteringsnyckel

`ROLLANDS_AUTH_ENCRYPTION_KEY` skyddar lagrade MFA-hemligheter. Den får aldrig bytas genom att bara ersätta miljövariabeln, eftersom befintliga MFA-hemligheter då inte längre kan dekrypteras.

Repositoryt har ett transaktionssäkert rotationsflöde:

`npm run platform:rotate-auth-key -- --apply`

Det kräver privat:
- `ROLLANDS_DATABASE_PATH`
- nuvarande `ROLLANDS_AUTH_ENCRYPTION_KEY`
- ny `ROLLANDS_NEW_AUTH_ENCRYPTION_KEY`

Flödet omkrypterar MFA-hemligheterna atomiskt, återkallar berörda sessioner och skriver auditposter utan att logga nyckelvärdena. Kör endast efter verifierad backup.

## MFA-hemligheter

En enskild användares TOTP-hemlighet roteras med:

`npm run platform:rotate-mfa -- --apply`

Den nya MFA-hemligheten ska överföras privat till rätt användare. Rotation återkallar användarens aktiva sessioner.

## R2 / objektlagring

R2-credentials ska vara separerade per ändamål:
- stagingobjekt,
- offsite-backup,
- oberoende audit-anchor.

De får inte återanvändas mellan rollerna. Skapa ny access key i Cloudflare, uppdatera secret manager, verifiera avsedd operation och återkalla därefter den gamla nyckeln.

Repositoryt får bara innehålla variabelnamn/placeholders, aldrig riktiga `R2_*_ACCESS_KEY_ID`, `R2_*_SECRET_ACCESS_KEY` eller session tokens.

## Cloudflare

LT Studio-applikationen behöver ingen Cloudflare API-token för normal request-trafik.

Om automation senare behöver Cloudflare API ska token:
- skapas som scoped API Token, inte Global API Key,
- begränsas till exakt zon/konto och nödvändiga rättigheter,
- lagras i deployment secret manager,
- aldrig exponeras som klientvariabel eller statisk JavaScript-konfiguration.

En remotely-managed Cloudflare Tunnel-token ska också behandlas som en serverhemlighet och lagras utanför GitHub.

## Tink, BankID och framtida integrationer

Client secrets och privata certifikat för bank-/identitetsintegrationer är endast server-side. Webbläsaren får enbart använda kortlivade publika flödesvärden som leverantörens dokumentation uttryckligen avser för klienten.

Tredjepartscredentials ska roteras hos leverantören och därefter uppdateras i serverns secret manager. Gamla credentials återkallas efter verifiering.

## Före pilot/produktion

Även om ingen exponerad hemlighet har hittats ska produktionscredentials vara nygenererade för den verkliga miljön och inte återanvända utvecklings-/stagingvärden.

Före pilot ska minst följande vara verifierat:
- full Git-history secret scan är grön,
- client/build secret scan är grön,
- inga riktiga secrets finns i repo eller statiska artifacts,
- auth- och backupnycklar är unika och separata,
- providercredentials har minsta möjliga scope,
- ansvarig person vet hur varje credential återkallas och roteras.

Om en scan hittar en riktig credential stoppas pilot tills rotationen är klar.
