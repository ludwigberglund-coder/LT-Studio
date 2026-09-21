# Pre-launch: BankID och Tink Link

Status: **planerat, inte implementerat**.

Det här dokumentet samlar externa integrationer som ska vara utredda, testade och produktionsklara före bred kommersiell launch av LT Studio. De ska inte beskrivas som färdiga innan kod, avtal, säkerhetskontroller och produktionsbevis finns.

## 1. Tink Link – bankkoppling

**Mål:** LT Studio ska i framtiden använda Tink Link för bankkoppling i stället för att bygga egna bankspecifika inloggningsflöden.

Preliminär ordning:

1. färdigställ nuvarande production-readiness och pilotflöden,
2. stabilisera datamodell, bokföring och drift,
3. bygg Tink Link som en av de sista större integrationerna före bred launch,
4. testa först med Tinks test-/fake-bank-flöden,
5. gå inte vidare till riktiga bankuppgifter förrän testbevis, behörigheter, felhantering, loggning och återställning är verifierade.

Referens för testscenarier:
https://docs.tink.com/resources/account-check/test-different-account-check-scenarios

Bankhemligheter, access tokens och privata kunduppgifter får aldrig lagras i GitHub.

## 2. BankID – inloggning

**Mål:** LT Studio ska erbjuda BankID som säker personlig inloggning före bred kommersiell launch.

BankID ska vara ett separat autentiseringsflöde och ska inte ersätta företagstillhörighet, sessionskontroller, CSRF-skydd, audit eller tenant-isolering. BankID bevisar vem personen är; LT Studios egen databas avgör vilket företag personen får använda.

### Rekommenderad teknisk modell

Använd i första hand en BankID-återförsäljare/integratör med OpenID Connect (OIDC) eller ett väl avgränsat server-side API. Hemligheter och certifikat ska ligga utanför repot i produktionsmiljön.

Planerat flöde:

1. användaren väljer **Logga in med BankID**,
2. LT Studios backend skapar en autentiseringsbegäran hos vald leverantör,
3. användaren identifierar sig med BankID, via samma enhet eller animerad QR-kod,
4. backend verifierar provider, token/signatur, state, nonce och callback,
5. den verifierade BankID-identiteten matchas mot en aktiv personlig LT Studio-användare,
6. befintliga företagsmedlemskap avgör vilket företag användaren får öppna,
7. LT Studio skapar därefter sin vanliga serverlagrade session, CSRF-token och auditpost,
8. övriga skyddade API:er fortsätter använda dagens sessions- och tenantkontroller.

### Anpassning till dagens kod

Dagens login finns i `apps/api/app.js` och använder:

- personlig användare,
- lösenord med scrypt,
- TOTP-MFA,
- serverlagrad session,
- HttpOnly/Secure/SameSite-cookie,
- CSRF-token,
- företagsmedlemskap,
- auditlogg,
- spärr efter upprepade felaktiga inloggningar.

BankID ska därför läggas **framför samma sessionsmodell**, inte skapa en parallell behörighetsmodell.

Preliminära nya endpoints:

- `GET /api/v1/auth/bankid/start`
- `GET /api/v1/auth/bankid/callback`

Efter lyckad BankID-verifiering ska befintlig sessionsskapning återanvändas.

### Identitetskoppling

BankID-användare får inte auto-kopplas till konto enbart på namn eller e-post.

En separat identitetskoppling ska införas, exempelvis en tabell som binder:

- intern `user_id`,
- provider,
- provider-subjekt/identifierare,
- säker lookup för verifierat personnummer när det behövs,
- tidpunkt och källa för kopplingen.

Personnummer ska dataminimeras och inte hamna i vanliga loggar, URL:er eller GitHub. Om personnummer behöver lagras ska lagrings- och krypteringsmodellen säkerhetsgranskas först.

BankID ska inte användas som genväg för att återställa eller skapa lösenordsinloggning utan separat regel- och säkerhetsgranskning.

## 3. Leverantörsspår för BankID

Prisjämförelse kontrollerad **2026-09-21**. Priser kan ändras och ska verifieras igen före avtal.

### Kostnadsmässigt förstaspår: TIC Identity

Offentlig prislista vid kontroll:

- Start: **0 kr/mån**, 50 BankID-autentiseringar/signeringar inkluderade.
- Fast: **795 kr/mån**, 1 000 BankID-autentiseringar/signeringar inkluderade.
- Därefter på Fast: **1 kr per autentisering/signering**.
- Volym: från **0,10 kr per autentisering**, offert.
- Leverantören uppger att den är BankID-återförsäljare och stödjer OIDC, REST API, hosted flow, webhooks, animerad QR-kod och testmiljö.

Källor:
https://tic.io/sv/produkter-tjanster/bank-id
https://id.tic.io/
https://id.tic.io/docs

Detta är det billigaste transparenta produktionsalternativ som hittats i den här genomgången för mycket låg startvolym. **Ingen leverantör är beslutad ännu.**

### Jämförelse: Idura Verify (tidigare Criipto)

Offentlig svensk prislista vid kontroll:

- Small: **740 kr/mån** för upp till 1 000 logins i plattformspaketet.
- Svenskt BankID: **0,15 kr per lyckad autentisering/signering** utöver plattformsavgiften.
- Testmiljö: gratis tills riktiga användare tas emot.
- Idura agerar återförsäljare för Swedbank och anger cirka 8–15 arbetsdagar från beställning till BankID är aktiverat i produktion.
- Engångsavgift för onboarding kan tillkomma.

Källa:
https://idura.eu/sv-se/priser/verify

## 4. Beslut före implementation

Innan BankID byggs in i main ska följande vara klart:

- leverantör vald efter pris + säkerhet + SLA + personuppgiftsbiträde,
- avtal och produktionsgodkännande,
- exakt callback-domän och HTTPS-hosting,
- secrets-hantering utanför GitHub,
- datamodell för BankID-identitet,
- regler för första koppling av befintliga användare,
- test-BankID i staging,
- tester för felaktig/avbruten/utgången autentisering,
- tester för fel företag och avstängt konto,
- session, CSRF och logout efter BankID-login,
- auditlogg som anger autentiseringsmetod utan att läcka personnummer,
- verifiering av animerad QR och samma-enhet-flöde,
- produktions-UAT innan BankID blir standardinloggning.

## 5. Launch-gate

Före bred kommersiell launch ska:

- Tink Link vara implementerat eller uttryckligen avgränsat från den första kommersiella releasen genom ett dokumenterat beslut,
- BankID-inloggning vara implementerad, säkerhetstestad och produktionsverifierad,
- inga leverantörshemligheter eller riktiga kunduppgifter finnas i GitHub.

Nuvarande Rolands-pilot kan fortsätta med befintlig personlig inloggning + MFA så länge den separata production-readiness-checklistan tillåter det. Den här planen gör alltså inte BankID till ett påstående om att dagens pilot redan har funktionen.
