# LT Studio / Rolands – konkret SaaS-målarkitektur

## Beslut

Plattformen ska byggas som **en gemensam SaaS-tjänst med en gemensam kodbas**, där varje kundföretag har en strikt avskild företagsmiljö.

Vi ska **inte** skapa en separat kopia av hela systemet för varje kund.

Rolands är första referenskund, men arkitekturen ska från början stödja fler företag utan att vi behöver duplicera kod.

## Kundupplevelsen

Den normala inloggningsvägen ska vara gemensam:

```text
ltstudio.se
  └─ publik LT Studio-webb

app.ltstudio.se
  └─ gemensam login
      └─ användarens företagsmiljö
          ├─ Rolands
          ├─ Kund B
          └─ Kund C
```

Efter inloggning ska servern avgöra vilket eller vilka företag användaren har medlemskap i.

Om användaren bara tillhör ett företag öppnas det direkt. Om användaren i framtiden tillhör flera företag kan ett säkert företagsval visas.

## Publika kundhemsidor hålls separata

Kundens publika hemsida ska vara en separat yta från affärssystemet.

Exempel:

```text
rolands.se
  └─ publik hemsida för Rolands kunder

app.ltstudio.se
  └─ privat verksamhetssystem för Rolands personal
```

Det gör att:

- en kund kan använda LT Studio utan att byta befintlig hemsida,
- LT Studio kan senare sälja hemsidan som en valfri integrerad tjänst,
- publikt innehåll och ekonomidata aldrig behöver blandas,
- samma centrala portal kan användas av alla företag.

En kundhemsida kan vid behov läsa publicerbart innehåll från plattformens API, exempelvis öppettider, erbjudanden eller sortiment. API:t måste då endast exponera uttryckligen publicerbar information.

## Företagsisolering

Alla privata verksamhetsobjekt ska alltid vara kopplade till ett internt oföränderligt `company_id`.

Det gäller bland annat:

- användarmedlemskap,
- kunder och leverantörer,
- kund- och leverantörsfakturor,
- betalningar,
- bokföring och verifikationer,
- banktransaktioner,
- lager,
- dokument,
- löneunderlag,
- inställningar,
- integrationer.

Klienten får aldrig själv bestämma vilket `company_id` som ska användas för ett skyddat API-anrop.

Rätt företag ska komma från den servervaliderade sessionen och medlemskapet.

Princip:

```text
Login
  ↓
Verifierad användare
  ↓
Aktivt medlemskap i företag
  ↓
Servern sätter company_id
  ↓
API + databasfrågor begränsas till company_id
```

## Rekommenderad teknisk struktur

```text
Internet
│
├─ ltstudio.se
│   └─ publik marknadswebb
│
├─ kundernas egna domäner
│   ├─ rolands.se
│   ├─ kund-b.se
│   └─ kund-c.se
│
└─ app.ltstudio.se
    │
    ├─ login / MFA / session
    │
    ├─ portal
    │
    └─ API
        │
        ├─ företagskontroll
        ├─ ekonomiregler
        ├─ fakturering
        ├─ bank
        ├─ lager
        ├─ dokument
        └─ rapportering
            │
            ├─ PostgreSQL
            │   └─ affärsdata med company_id
            │
            └─ skyddad objektlagring
                └─ dokument separerade per företag
```

## GitHub, drift och data

GitHub är sanningskälla för:

- programkod,
- tester,
- schema/migreringar,
- offentlig konfiguration,
- dokumentation,
- releasehistorik.

GitHub ska aldrig vara lagringsplats för skarp kunddata.

Skarp kunddata ska ligga i:

- produktionsdatabas,
- skyddad dokumentlagring,
- krypterad backup.

Hemligheter ska ligga i driftplattformens secret manager.

## Miljöflöde

Målet är:

```text
GitHub branch
  ↓
Pull request
  ↓
Automatiska tester
  ↓
main
  ↓
Staging
  ↓
Verifiering
  ↓
Produktion
```

Ingen produktionsändring ska byggas från lokala filer som inte finns i GitHub.

## Uppdateringar för alla kunder

En gemensam kodbas innebär att en förbättring kan distribueras till alla kunder genom en kontrollerad release.

Exempel:

```text
Ändring i fakturamodulen
  ↓
tester
  ↓
release
  ↓
samma nya version används av alla kundföretag
```

Det ska däremot inte betyda att alla företag automatiskt får alla funktioner. Funktioner kan aktiveras genom företagskonfiguration eller feature flags.

## Företagsspecifik konfiguration

Varje företag kan ha egna:

- namn och juridiska uppgifter,
- logotyp,
- färger,
- domän,
- webbplatsinnehåll,
- öppettider,
- fakturauppgifter,
- kontoplan,
- nummerserier,
- momsinställningar,
- aktiverade moduler,
- integrationsinställningar.

Skillnader mellan kunder ska i första hand lösas med konfiguration, inte med kundspecifika kodkopior.

## Domänstrategi

Första målbild:

```text
ltstudio.se        publik LT Studio-hemsida
app.ltstudio.se    gemensam kundportal
api.ltstudio.se    API, om det senare behöver egen domän
```

Kundernas publika webbplatser ligger på deras egna domäner.

Vi behöver inte börja med separata portalsubdomäner som `rolands.ltstudio.se`. Det kan införas senare som alias eller white-label-ingång utan att skapa en separat installation.

## Databasstrategi

För första skalbara produktionsversionen rekommenderas PostgreSQL eller annan jämförbar transaktionsdatabas.

Grundmodellen ska stödja minst:

```text
companies
users
company_memberships
customers
suppliers
invoices
payments
journal_entries
bank_transactions
inventory_events
documents
audit_events
```

Alla företagsbundna tabeller ska ha en tekniskt säker relation till rätt företag.

Utöver applikationsfiltrering bör databasen få starka constraints och, där det passar, Row Level Security eller motsvarande extra skydd.

Den stegvisa övergången från nuvarande SQLite är dokumenterad i [POSTGRESQL-MIGRATION-PLAN.md](POSTGRESQL-MIGRATION-PLAN.md). Planen är beslutad som riktning, men PostgreSQL är ännu inte infört i drift.

## Dokumentlagring

Fakturabilagor, kvitton och andra filer ska inte ligga i GitHub eller direkt i publik webb.

Rekommenderad princip:

```text
documents/
  company-uuid-1/
  company-uuid-2/
  company-uuid-3/
```

Sökvägen ensam är inte säkerheten. Servern måste alltid kontrollera medlemskap innan en signerad eller skyddad filåtkomst lämnas ut.

## Backup och återställning

Backup måste vara en del av plattformen, inte något som löses per kund i efterhand.

Minimikrav:

- automatiska databackuper,
- krypterade backuper,
- backup på dokumentlagring,
- separat lagringsplats,
- retention,
- regelbundna återställningstester,
- dokumenterad återställningsrutin.

Vi ska kunna återställa en miljö utan att blanda kunders data.

## Nästa tekniska steg

Vi ska inte bygga nya stora moduler nu. Följande bör göras i ordning inom den nuvarande production-readiness-fasen:

1. Behåll Rolands som första referenskund.
2. Säkerställ att alla nuvarande privata objekt verkligen är företagsbundna.
3. Lägg till en andra helt fiktiv testkund i automatiska isoleringstester.
4. Kartlägg kvarvarande Rolands-specifik kod som bör flyttas till konfiguration.
5. ✅ PostgreSQL-migreringen är dokumenterad i [POSTGRESQL-MIGRATION-PLAN.md](POSTGRESQL-MIGRATION-PLAN.md); själva motorbytet är ännu inte påbörjat.
6. Behåll personlig inloggning, MFA och servervaliderade sessioner.
7. Behåll publik webb och privat portal som separata säkerhetsgränser.
8. Lägg produktionsdrift bakom staging och verifierad releaseprocess.
9. Fortsätt backup-/restore-arbetet innan verklig kunddata används.
10. Först därefter görs Rolands till första skarpa kundmiljö.

## Definition av att plattformen är redo för kund nummer två

Vi har bevisat den gemensamma SaaS-arkitekturen när en andra testkund kan skapas utan kopiering av kod och följande fungerar:

- egen företagsprofil,
- egen användare,
- egen faktura,
- egen bokföringspost,
- eget dokument,
- egen lagerdata,
- egen webbkonfiguration,
- noll åtkomst till Rolands data,
- Rolands har noll åtkomst till testkundens data,
- samma applikationsversion används av båda.

Detta test ska på sikt vara en blockerande kontroll i CI före produktionsrelease.

## Arkitekturbeslut

> LT Studio byggs som en central multi-tenant SaaS-plattform med gemensam kodbas och gemensamma releaser. Kunddata och dokument hålls strikt isolerade per företag. Publika kundhemsidor är separata från den privata portalen och kan integreras med plattformen som en valfri tjänst. Rolands är första referenskund, inte en separat produktkodbas.
